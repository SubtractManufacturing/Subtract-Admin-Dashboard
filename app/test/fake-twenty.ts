import {
  TwentyApiError,
  type TwentyApi,
  type TwentyFields,
  type TwentyPerson,
} from "~/lib/twenty/client.server";
import { ERP_QUOTE_ID_FIELD, type TwentyCompanySummary } from "~/lib/twenty/matching";

/** In-memory Twenty workspace that records writes and enforces unique emails. */
export class FakeTwenty implements TwentyApi {
  companies: TwentyCompanySummary[] = [];
  people: TwentyPerson[] = [];
  opportunities: Array<{ id: string; name: string; fields: TwentyFields }> = [];
  writes: Array<{ op: string; id?: string; fields: TwentyFields }> = [];
  down = false;
  /** Twenty commits the next create, but the response never reaches the ERP. */
  loseNextCreateResponse = false;
  private nextId = 1;

  private guard() {
    if (this.down) throw new TwentyApiError("Could not reach Twenty", null, true);
  }

  async listCompanies() {
    this.guard();
    return [...this.companies];
  }
  async createCompany(fields: TwentyFields) {
    this.guard();
    const id = `company-${this.nextId++}`;
    const url = (fields.domainName as { primaryLinkUrl?: string } | undefined)
      ?.primaryLinkUrl;
    this.companies.push({
      id,
      name: fields.name as string,
      domain: url?.replace("https://", "") ?? null,
    });
    this.writes.push({ op: "createCompany", fields });
    return { id };
  }
  async getPerson(id: string) {
    this.guard();
    return this.people.find((person) => person.id === id) ?? null;
  }
  async findPersonByEmail(email: string) {
    this.guard();
    return this.people.find((person) => person.emails?.primaryEmail === email) ?? null;
  }
  async findPeopleByName(name: { firstName: string; lastName: string }) {
    this.guard();
    return this.people.filter(
      (person) =>
        person.name?.firstName === name.firstName &&
        person.name?.lastName === name.lastName,
    );
  }
  async createPerson(fields: TwentyFields) {
    this.guard();
    const id = `person-${this.nextId++}`;
    this.people.push({ id, ...(fields as Partial<TwentyPerson>) });
    this.writes.push({ op: "createPerson", fields });
    return { id };
  }
  async updatePerson(id: string, fields: TwentyFields) {
    this.guard();
    Object.assign(this.people.find((person) => person.id === id) as TwentyPerson, fields);
    this.writes.push({ op: "updatePerson", id, fields });
  }
  async findOpportunitiesByErpQuoteId(erpQuoteId: string) {
    this.guard();
    return this.opportunities
      .filter((item) => item.fields[ERP_QUOTE_ID_FIELD] === erpQuoteId)
      .map(({ id }) => ({ id }));
  }
  async createOpportunity(fields: TwentyFields) {
    this.guard();
    const erpQuoteId = fields[ERP_QUOTE_ID_FIELD];
    if (this.opportunities.some((item) => item.fields[ERP_QUOTE_ID_FIELD] === erpQuoteId)) {
      throw new TwentyApiError("Twenty returned 400: duplicate entry", 400, false);
    }
    const id = `opportunity-${this.nextId++}`;
    this.opportunities.push({ id, name: fields.name as string, fields: { ...fields } });
    this.writes.push({ op: "createOpportunity", fields });
    if (this.loseNextCreateResponse) {
      this.loseNextCreateResponse = false;
      throw new TwentyApiError("Could not reach Twenty (TimeoutError)", null, true);
    }
    return { id };
  }
  async readOpportunity(id: string) {
    this.guard();
    const item = this.opportunities.find((opportunity) => opportunity.id === id);
    if (!item) return null;
    const { fields } = item;
    return {
      id,
      name: fields.name as string,
      amount: (fields.amount as { amountMicros: number | null }) ?? null,
      rfqStatus: (fields.rfqStatus as string) ?? null,
      company: this.companies.find((company) => company.id === fields.companyId) ?? null,
      pointOfContact:
        this.people.find((person) => person.id === fields.pointOfContactId) ?? null,
    };
  }
  async updateOpportunity(id: string, fields: TwentyFields) {
    this.guard();
    const item = this.opportunities.find((opportunity) => opportunity.id === id);
    if (!item) throw new TwentyApiError("Twenty returned 404", 404, false);
    Object.assign(item.fields, fields);
    this.writes.push({ op: "updateOpportunity", id, fields });
  }
  writesOf(op: string) {
    return this.writes.filter((write) => write.op === op);
  }
}
