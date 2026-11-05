/**
 * One-way ERP to Twenty sync. Every run reads the tables for what changed, so a run
 * started by a hook (see notify.server.ts) and the scheduled reconciliation sweep do
 * the same work, and nothing here can delay quotes or emails.
 */
import type { TwentySyncLink } from "../db/schema";
import { normalizeEmail } from "../email-normalize";
import {
  TwentyApiError,
  type TwentyApi,
  type TwentyFields,
  type TwentyPerson,
} from "./client.server";
import {
  CLEARED_TWENTY_AMOUNT,
  companyIdentityFor,
  companyKeyFor,
  ERP_QUOTE_ID_FIELD,
  isQuoteSendConfirmed,
  matchCompany,
  opportunityName,
  phoneDigits,
  RFQ_STATUS_BY_QUOTE_STATUS,
  splitContactName,
  toTwentyAmount,
  toTwentyPhone,
  type CompanyChoiceDetail,
  type CompanyIdentity,
  type TwentyCompanySummary,
} from "./matching";

export const MAX_RECORDS_PER_RUN = 20;
/** Failing records step back so a poisoned row cannot crowd out newer work. */
const RETRY_DELAYS_MINUTES = [2, 5, 15, 60] as const;

export type SyncEntityType = "customer" | "quote";

export interface SyncCustomer {
  id: number;
  displayName: string;
  companyName: string | null;
  contactName: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  updatedAt: Date;
}

export interface SyncQuote {
  id: number;
  quoteNumber: string;
  customerId: number;
  status: string;
  total: string | null;
  /** The quote's change version: its updatedAt or its latest quote send, whichever is newer. */
  updatedAt: Date;
  /** When the quote last moved to Sent. */
  sentAt: Date | null;
  /** Status of the latest priced quote email; null when none was ever queued. */
  lastSendStatus: string | null;
  lastSendUpdatedAt: Date | null;
}

export interface DueRecord {
  entityType: SyncEntityType;
  entityId: number;
}

export interface TwentySyncStore {
  listDue(args: {
    now: Date;
    syncStartedAt: Date;
    limit: number;
  }): Promise<DueRecord[]>;
  getCustomer(id: number): Promise<SyncCustomer | null>;
  getQuote(id: number): Promise<SyncQuote | null>;
  findQuoteByNumber(
    quoteNumber: string,
  ): Promise<{ id: number; isArchived: boolean } | null>;
  getLink(entityType: SyncEntityType, entityId: number): Promise<TwentySyncLink | null>;
  saveCustomerLink(
    customerId: number,
    values: {
      twentyPersonId: string | null;
      twentyCompanyId: string | null;
      syncedCompanyKey: string;
      syncedSourceUpdatedAt: Date;
      syncWarning: string | null;
    },
    now: Date,
    /** In one transaction, so a correction cannot save without reaching its quotes. */
    options: { invalidateQuotes: boolean },
  ): Promise<void>;
  saveQuoteLink(
    quoteId: number,
    values: {
      twentyOpportunityId: string;
      syncedQuoteStatus: string;
      syncedAmountMicros: number | null;
      syncedSourceUpdatedAt: Date;
      twentyCompanyId: string | null;
      twentyPersonId: string | null;
    },
    now: Date,
  ): Promise<void>;
  markFailed(
    record: DueRecord,
    error: string,
    now: Date,
    detail?: CompanyChoiceDetail | null,
  ): Promise<void>;
}

export interface TwentySyncResult {
  synced: number;
  failed: number;
  /** True when Twenty looked unavailable and the run stopped early. */
  stoppedEarly: boolean;
}

/** Staff decide which company is right; the sync never guesses or asks them to change Twenty. */
export class CompanyChoiceRequiredError extends TwentyApiError {
  constructor(readonly detail: CompanyChoiceDetail) {
    super(
      `More than one Twenty company could be ${detail.companyName}. Choose the right one.`,
      null,
      false,
    );
    this.name = "CompanyChoiceRequiredError";
  }
}

function phoneWarning(phone: string): string {
  return `Phone "${phone}" could not be synced to Twenty. Correct it on the customer.`;
}

export function retryDelayMinutes(attemptCount: number): number {
  const index = Math.min(attemptCount, RETRY_DELAYS_MINUTES.length) - 1;
  return RETRY_DELAYS_MINUTES[Math.max(index, 0)];
}

interface CustomerLinkIds {
  twentyPersonId: string | null;
  twentyCompanyId: string | null;
}

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isPhoneRejection(error: unknown): boolean {
  return (
    error instanceof TwentyApiError &&
    error.status !== null &&
    error.status < 500 &&
    /phone/i.test(error.message)
  );
}

class SyncContext {
  private companies: TwentyCompanySummary[] | null = null;
  /** A customer is pushed once per run however many of its quotes are due. */
  private readonly customersThisRun = new Map<number, CustomerLinkIds>();

  constructor(
    private readonly store: TwentySyncStore,
    private readonly twenty: TwentyApi,
    private readonly now: () => Date,
  ) {}

  private async resolveCompany(
    customer: SyncCustomer,
    identity: CompanyIdentity,
  ): Promise<string | null> {
    if (!identity.name && !identity.weakName && !identity.domain) return null;

    this.companies ??= await this.twenty.listCompanies();
    const match = matchCompany(this.companies, identity);
    if (match.kind === "matched") return match.id;
    if (match.kind === "ambiguous") {
      throw new CompanyChoiceRequiredError({
        kind: "company_choice",
        customerId: customer.id,
        companyName: identity.name ?? identity.weakName ?? customer.displayName,
        candidates: match.candidates,
      });
    }

    // A weak name may be a person, so on its own it never creates a company.
    const name = identity.name ?? identity.domain;
    if (!name) return null;
    const domain = match.domainTaken ? null : identity.domain;
    const fields: TwentyFields = { name };
    if (domain) {
      fields.domainName = {
        primaryLinkUrl: `https://${domain}`,
        primaryLinkLabel: "",
        secondaryLinks: [],
      };
    }
    const { id } = await this.twenty.createCompany(fields);
    this.companies.push({ id, name, domain });
    return id;
  }

  /** Only fields the ERP has a value for are written; blanks keep Twenty's data. */
  private personChanges(
    customer: SyncCustomer,
    person: TwentyPerson | null,
    email: string | null,
  ): TwentyFields {
    const fields: TwentyFields = {};

    const name = splitContactName(customer.contactName);
    if (
      name &&
      (name.firstName !== (person?.name?.firstName ?? "") ||
        name.lastName !== (person?.name?.lastName ?? ""))
    ) {
      fields.name = name;
    }

    const title = nonBlank(customer.title);
    if (title && title !== (person?.jobTitle ?? "")) fields.jobTitle = title;

    const currentEmail = normalizeEmail(person?.emails?.primaryEmail);
    const additionalEmails = person?.emails?.additionalEmails ?? [];
    const isKnownAddress = additionalEmails.some((known) => normalizeEmail(known) === email);
    if (email && email !== currentEmail && !isKnownAddress) {
      const additional = new Set(additionalEmails);
      if (currentEmail) additional.add(currentEmail);
      additional.delete(email);
      fields.emails = { primaryEmail: email, additionalEmails: [...additional] };
    }

    const phone = toTwentyPhone(customer.phone);
    if (
      phone &&
      phoneDigits(phone.primaryPhoneNumber) !==
        phoneDigits(person?.phones?.primaryPhoneNumber)
    ) {
      fields.phones = {
        ...phone,
        additionalPhones: person?.phones?.additionalPhones ?? [],
      };
    }
    return fields;
  }

  private async findPerson(
    customer: SyncCustomer,
    link: TwentySyncLink | null,
    email: string | null,
    companyId: string | null,
  ): Promise<TwentyPerson | null> {
    const linked = link?.twentyPersonId
      ? await this.twenty.getPerson(link.twentyPersonId)
      : null;
    if (linked) {
      const addresses = [
        linked.emails?.primaryEmail,
        ...(linked.emails?.additionalEmails ?? []),
      ].map((address) => normalizeEmail(address));
      if (!email || addresses.includes(email)) return linked;
      // The ERP email moved. Another person holding it wins, as emails are unique.
      return (await this.twenty.findPersonByEmail(email)) ?? linked;
    }
    if (email) return this.twenty.findPersonByEmail(email);

    const name = splitContactName(customer.contactName);
    if (!name || !companyId) return null;
    const namesakes = await this.twenty.findPeopleByName(name);
    const atCompany = namesakes.filter((person) => person.companyId === companyId);
    return atCompany.length === 1 ? atCompany[0] : null;
  }

  /** A number Twenty refuses should not cost us the rest of the contact. */
  private async withoutRejectedPhone<T>(
    fields: TwentyFields,
    write: (fields: TwentyFields) => Promise<T>,
    onRejected: () => void,
  ): Promise<T> {
    try {
      return await write(fields);
    } catch (error) {
      if (!fields.phones || !isPhoneRejection(error)) throw error;
      onRejected();
      const withoutPhone = { ...fields };
      delete withoutPhone.phones;
      return write(withoutPhone);
    }
  }

  private async resolvePerson(
    customer: SyncCustomer,
    link: TwentySyncLink | null,
    companyId: string | null,
  ): Promise<{ id: string | null; warning: string | null }> {
    const email = normalizeEmail(customer.email);
    const person = await this.findPerson(customer, link, email, companyId);
    const fields = this.personChanges(customer, person, email);

    const phone = nonBlank(customer.phone);
    let warning = phone && !toTwentyPhone(phone) ? phoneWarning(phone) : null;
    const onPhoneRejected = () => {
      warning = phone ? phoneWarning(phone) : null;
    };

    if (person) {
      // Twenty allows one company per person, and a contact may buy for several.
      // Only fill a blank here; each opportunity carries its own company.
      if (companyId && !person.companyId) fields.companyId = companyId;
      if (Object.keys(fields).length > 0) {
        await this.withoutRejectedPhone(fields, async (changes) => {
          if (Object.keys(changes).length > 0) {
            await this.twenty.updatePerson(person.id, changes);
          }
        }, onPhoneRejected);
      }
      return { id: person.id, warning };
    }

    if (!email && !fields.name) return { id: null, warning: null };
    if (companyId) fields.companyId = companyId;
    const created = await this.withoutRejectedPhone(
      fields,
      (changes) => this.twenty.createPerson(changes),
      onPhoneRejected,
    );
    return { id: created.id, warning };
  }

  async syncCustomer(customerId: number): Promise<CustomerLinkIds> {
    const done = this.customersThisRun.get(customerId);
    if (done) return done;

    const customer = await this.store.getCustomer(customerId);
    if (!customer) {
      throw new TwentyApiError(`ERP customer ${customerId} no longer exists`, null, false);
    }

    const link = await this.store.getLink("customer", customerId);
    if (link?.syncedSourceUpdatedAt?.getTime() === customer.updatedAt.getTime()) {
      const ids = {
        twentyPersonId: link.twentyPersonId,
        twentyCompanyId: link.twentyCompanyId,
      };
      this.customersThisRun.set(customerId, ids);
      return ids;
    }

    const identity = companyIdentityFor(customer);
    const companyKey = companyKeyFor(identity);
    const companyId =
      link?.twentyCompanyId && link.syncedCompanyKey === companyKey
        ? link.twentyCompanyId
        : await this.resolveCompany(customer, identity);
    const { id: personId, warning } = await this.resolvePerson(customer, link, companyId);

    // A renamed company keeps its IDs but still changes the opportunity's name.
    const moved =
      link?.syncedSourceUpdatedAt != null &&
      (link.twentyCompanyId !== companyId ||
        link.twentyPersonId !== personId ||
        link.syncedCompanyKey !== companyKey);
    await this.store.saveCustomerLink(
      customerId,
      {
        twentyPersonId: personId,
        twentyCompanyId: companyId,
        syncedCompanyKey: companyKey,
        syncedSourceUpdatedAt: customer.updatedAt,
        syncWarning: warning,
      },
      this.now(),
      { invalidateQuotes: moved },
    );

    const ids = { twentyPersonId: personId, twentyCompanyId: companyId };
    this.customersThisRun.set(customerId, ids);
    return ids;
  }

  /**
   * Finds the opportunity by the ERP quote ID stored on it. This is what makes a
   * retry safe when Twenty kept a create but the response or local link was lost.
   */
  private async findExistingOpportunity(quoteId: number): Promise<string | null> {
    const found = await this.twenty.findOpportunitiesByErpQuoteId(String(quoteId));
    if (found.length > 1) {
      throw new TwentyApiError(
        `Several Twenty opportunities carry ERP quote ID ${quoteId}. Remove the extra one, then retry.`,
        null,
        false,
      );
    }
    return found[0]?.id ?? null;
  }

  /** The field is unique in Twenty, so losing a race is a refused create, not a duplicate. */
  private async createOpportunity(
    quoteId: number,
    fields: TwentyFields,
  ): Promise<{ id: string; created: boolean }> {
    try {
      const { id } = await this.twenty.createOpportunity({
        ...fields,
        [ERP_QUOTE_ID_FIELD]: String(quoteId),
      });
      return { id, created: true };
    } catch (error) {
      if (!(error instanceof TwentyApiError) || error.transient) throw error;
      const existing = await this.findExistingOpportunity(quoteId);
      if (!existing) throw error;
      await this.twenty.updateOpportunity(existing, fields);
      return { id: existing, created: false };
    }
  }

  async syncQuote(
    quoteId: number,
  ): Promise<{ opportunityId: string; created: boolean; customerId: number }> {
    const quote = await this.store.getQuote(quoteId);
    if (!quote) {
      throw new TwentyApiError(`ERP quote ${quoteId} no longer exists`, null, false);
    }

    // The quote's own customer account decides the company, never the email domain.
    const contact = await this.syncCustomer(quote.customerId);
    const customer = await this.store.getCustomer(quote.customerId);
    const label =
      nonBlank(customer?.companyName) ?? nonBlank(customer?.displayName) ?? "Customer";

    const link = await this.store.getLink("quote", quoteId);
    const linkedId = link?.twentyOpportunityId ?? null;
    const opportunityId = linkedId ?? (await this.findExistingOpportunity(quoteId));

    const fields: TwentyFields = { name: opportunityName(quote.quoteNumber, label) };
    // A link the ERP supplied is cleared when it goes away, as when a quote moves to
    // an individual. One added by hand in Twenty was never ours, so it stays.
    if (contact.twentyCompanyId) fields.companyId = contact.twentyCompanyId;
    else if (link?.twentyCompanyId) fields.companyId = null;
    if (contact.twentyPersonId) fields.pointOfContactId = contact.twentyPersonId;
    else if (link?.twentyPersonId) fields.pointOfContactId = null;

    const amount = toTwentyAmount(quote.total);
    if (amount) {
      fields.amount = amount;
    } else if (link?.syncedAmountMicros || (opportunityId && !linkedId)) {
      // A recovered opportunity may hold an amount this link never recorded.
      fields.amount = CLEARED_TWENTY_AMOUNT;
    }

    // Until a priced quote is confirmed sent, the last confirmed status stands.
    const sendPending =
      quote.status === "Sent" &&
      !isQuoteSendConfirmed({
        status: quote.lastSendStatus,
        updatedAt: quote.lastSendUpdatedAt,
        quoteSentAt: quote.sentAt,
      });
    const status = sendPending ? (link?.syncedQuoteStatus ?? "Draft") : quote.status;
    const rfqStatus = RFQ_STATUS_BY_QUOTE_STATUS[status];
    if (rfqStatus && link?.syncedQuoteStatus !== status) {
      fields.rfqStatus = rfqStatus;
    }

    let result: { id: string; created: boolean };
    if (opportunityId) {
      // The ERP still has the quote, so a deleted opportunity comes back with its status.
      const restoredFields = { ...fields, rfqStatus: rfqStatus ?? "QUOTING" };
      try {
        const { deletedAt } = await this.twenty.updateOpportunity(opportunityId, fields);
        if (deletedAt) {
          // In Twenty's trash: it still holds the unique erpQuoteId, so a new one can't be
          // made. Restore last, so a failure leaves it trashed and the retry redoes all of this.
          await this.twenty.updateOpportunity(opportunityId, restoredFields);
          await this.twenty.restoreOpportunity(opportunityId);
        }
        result = { id: opportunityId, created: false };
      } catch (error) {
        if (!(error instanceof TwentyApiError) || error.status !== 404) throw error;
        // Permanently deleted, so only a new record can replace it.
        result = await this.createOpportunity(quoteId, restoredFields);
      }
    } else {
      result = await this.createOpportunity(quoteId, fields);
    }

    await this.store.saveQuoteLink(
      quoteId,
      {
        twentyOpportunityId: result.id,
        syncedQuoteStatus: status,
        syncedAmountMicros: amount?.amountMicros ?? null,
        syncedSourceUpdatedAt: quote.updatedAt,
        twentyCompanyId: contact.twentyCompanyId,
        twentyPersonId: contact.twentyPersonId,
      },
      this.now(),
    );
    return { opportunityId: result.id, created: result.created, customerId: quote.customerId };
  }
}

function failureDetail(error: unknown): CompanyChoiceDetail | null {
  return error instanceof CompanyChoiceRequiredError ? error.detail : null;
}

function errorMessage(error: unknown): string {
  return error instanceof TwentyApiError
    ? error.message
    : "Unexpected sync error; see the server log";
}

export interface SingleQuoteSyncReport {
  quoteNumber: string;
  customerId: number;
  /** False on a repeat run, which must update the same opportunity. */
  created: boolean;
  /** Opportunities in Twenty carrying this quote's ID. Anything but 1 is a problem. */
  matchingOpportunities: number;
  opportunityId: string;
  opportunityName: string | null;
  amount: number | null;
  rfqStatus: string | null;
  company: string | null;
  contactName: string | null;
  contactEmail: string | null;
  /** Something the ERP holds that could not go to Twenty, such as a bad phone number. */
  warning: string | null;
}

export type SingleQuoteSyncResult =
  | { ok: true; report: SingleQuoteSyncReport }
  | { ok: false; error: string };

/**
 * Syncs one chosen quote and reads the result back from Twenty, for validating
 * against the live workspace. Works while the scheduled sync is disabled and
 * ignores the enable date; it never touches any other quote.
 */
export async function syncOneQuote(deps: {
  store: TwentySyncStore;
  twenty: TwentyApi;
  quoteNumber: string;
  now?: () => Date;
}): Promise<SingleQuoteSyncResult> {
  const now = deps.now ?? (() => new Date());
  const quoteNumber = deps.quoteNumber.trim();
  const quote = await deps.store.findQuoteByNumber(quoteNumber);
  if (!quote) return { ok: false, error: `Quote ${quoteNumber} was not found.` };
  if (quote.isArchived) return { ok: false, error: `Quote ${quoteNumber} is archived.` };

  const record: DueRecord = { entityType: "quote", entityId: quote.id };
  let synced: { opportunityId: string; created: boolean; customerId: number };
  try {
    synced = await new SyncContext(deps.store, deps.twenty, now).syncQuote(quote.id);
  } catch (error) {
    if (!(error instanceof TwentyApiError)) {
      console.error(`[Twenty] quote ${quote.id} failed`, error);
    }
    const message = errorMessage(error);
    // Recording can fail for the same reason the sync did; the caller still gets the result.
    await deps.store
      .markFailed(record, message, now(), failureDetail(error))
      .catch((saveError) => {
        console.error(`[Twenty] could not record the failure for quote ${quote.id}`, saveError);
      });
    return { ok: false, error: message };
  }

  // The sync itself succeeded, so a failed read-back is not a failed record.
  try {
    const { opportunityId, created, customerId } = synced;
    const [opportunity, matches, customerLink] = await Promise.all([
      deps.twenty.readOpportunity(opportunityId),
      deps.twenty.findOpportunitiesByErpQuoteId(String(quote.id)),
      deps.store.getLink("customer", customerId),
    ]);
    const micros = opportunity?.amount?.amountMicros;
    const person = opportunity?.pointOfContact;
    return {
      ok: true,
      report: {
        quoteNumber,
        customerId,
        created,
        matchingOpportunities: matches.length,
        opportunityId,
        opportunityName: opportunity?.name ?? null,
        amount: micros == null ? null : Number(micros) / 1_000_000,
        rfqStatus: opportunity?.rfqStatus ?? null,
        company: opportunity?.company?.name ?? null,
        contactName:
          [person?.name?.firstName, person?.name?.lastName].filter(Boolean).join(" ") ||
          null,
        contactEmail: person?.emails?.primaryEmail ?? null,
        warning: customerLink?.syncWarning ?? null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: `Synced, but could not read the result back: ${errorMessage(error)}`,
    };
  }
}

/** Runs one sweep. Failures are recorded per record and never thrown to the queue. */
export async function runTwentySync(deps: {
  store: TwentySyncStore;
  twenty: TwentyApi;
  syncStartedAt: Date;
  now?: () => Date;
  limit?: number;
}): Promise<TwentySyncResult> {
  const now = deps.now ?? (() => new Date());
  const due = await deps.store.listDue({
    now: now(),
    syncStartedAt: deps.syncStartedAt,
    limit: deps.limit ?? MAX_RECORDS_PER_RUN,
  });

  const context = new SyncContext(deps.store, deps.twenty, now);
  const result: TwentySyncResult = { synced: 0, failed: 0, stoppedEarly: false };

  for (const record of due) {
    try {
      if (record.entityType === "customer") {
        await context.syncCustomer(record.entityId);
      } else {
        await context.syncQuote(record.entityId);
      }
      result.synced += 1;
    } catch (error) {
      if (!(error instanceof TwentyApiError)) {
        console.error(`[Twenty] ${record.entityType} ${record.entityId} failed`, error);
      }
      await deps.store.markFailed(record, errorMessage(error), now(), failureDetail(error));
      result.failed += 1;
      // During an outage the remaining records would only collect failed attempts.
      if (error instanceof TwentyApiError && error.transient) {
        result.stoppedEarly = true;
        break;
      }
    }
  }
  return result;
}
