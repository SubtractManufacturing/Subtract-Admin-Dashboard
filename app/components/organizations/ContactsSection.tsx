import { useFetcher } from "@remix-run/react";
import { Star, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import Button from "~/components/shared/Button";
import { InputField, PhoneInputField } from "~/components/shared/FormField";
import Modal from "~/components/shared/Modal";
import type { MergeFieldChoice } from "~/lib/customer-merge-view";
import { contactDisplayName, type ContactRecord } from "~/lib/organizations/types";

type ContactMergePreview = {
  survivor: { id: string; name: string | null; emails: string[] };
  merged: { id: string; name: string | null; emails: string[] };
  retainedEmails: string[];
  joinsOrganizations: Array<{ id: string; name: string }>;
  communications: number;
  conflicts: Array<{ field: string; label: string; survivorValue: string; mergedValue: string; defaultChoice: MergeFieldChoice }>;
  autoFills: Array<{ field: string; label: string; value: string }>;
  survivorUpdatedAt: string;
  mergedUpdatedAt: string;
};

type Props = {
  contacts: ContactRecord[];
  /** Pairs of Contacts here that look like the same person. */
  duplicatePairs?: Array<{ a: string; b: string; reason: "email" | "name" }>;
  /** Admin/Dev may merge Contacts. */
  canMerge?: boolean;
  /** This page's URL, for the merge to return to. */
  returnTo: string;
};

function ContactForm({
  contact,
  onDone,
}: {
  contact?: ContactRecord;
  onDone: () => void;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onDone();
  }, [fetcher.state, fetcher.data, onDone]);
  return (
    <fetcher.Form method="post" className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-700">
      <input type="hidden" name="intent" value={contact ? "updateContact" : "addContact"} />
      {contact && <input type="hidden" name="contactId" value={contact.id} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <InputField label="Name" name="contactName" defaultValue={contact?.name ?? ""} placeholder="Jane Smith" />
        <InputField label="Title" name="title" defaultValue={contact?.title ?? ""} placeholder="Purchasing Manager" />
        <InputField label="Email" name="email" type="email" defaultValue={contact?.email ?? ""} />
        <PhoneInputField label="Phone" name="phone" defaultValue={contact?.phone ?? ""} />
        <InputField
          label="Role here"
          name="role"
          defaultValue={contact?.role ?? ""}
          placeholder="Engineering, accounts payable…"
        />
      </div>
      {!contact && (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" name="makePrimary" value="true" className="rounded border-gray-300" />
          Make primary contact
        </label>
      )}
      {fetcher.data?.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {fetcher.data.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={fetcher.state !== "idle"}>
          {contact ? "Save" : "Add contact"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </fetcher.Form>
  );
}

function ContactMergeModal({
  pair,
  contacts,
  returnTo,
  onClose,
}: {
  pair: { survivorId: string; mergedId: string };
  contacts: ContactRecord[];
  returnTo: string;
  onClose: () => void;
}) {
  const [ids, setIds] = useState(pair);
  const previewFetcher = useFetcher<{ preview?: ContactMergePreview; error?: string }>();
  const mergeFetcher = useFetcher<{ error?: string }>();
  const [choices, setChoices] = useState<Record<string, MergeFieldChoice>>({});

  useEffect(() => {
    if (ids.survivorId === ids.mergedId) return;
    previewFetcher.load(`/customers/merge?preview=contact&survivor=${ids.survivorId}&merged=${ids.mergedId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.survivorId, ids.mergedId]);

  const preview = previewFetcher.data?.preview;
  const current =
    preview && preview.survivor.id === ids.survivorId && preview.merged.id === ids.mergedId ? preview : undefined;
  useEffect(() => {
    if (current) {
      setChoices(Object.fromEntries(current.conflicts.map((c) => [c.field, c.defaultChoice])));
    }
  }, [current]);

  const nameOf = (id: string) => {
    const contact = contacts.find((c) => c.id === id);
    return contact ? contactDisplayName(contact) : "Contact";
  };

  const submit = () => {
    if (!current) return;
    const payload: Record<string, string> = {
      intent: "mergeContacts",
      survivorId: ids.survivorId,
      mergedId: ids.mergedId,
      survivorUpdatedAt: new Date(current.survivorUpdatedAt).toISOString(),
      mergedUpdatedAt: new Date(current.mergedUpdatedAt).toISOString(),
      returnTo,
    };
    for (const [field, choice] of Object.entries(choices)) payload[`choice:${field}`] = choice;
    mergeFetcher.submit(payload, { method: "post", action: "/customers/merge" });
  };

  return (
    <Modal isOpen onClose={onClose} title="Merge Contacts" size="lg" zIndex={60}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              ["survivorId", "Keep"],
              ["mergedId", "Merge in and archive"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {label}
              <select
                value={ids[key]}
                onChange={(event) => setIds((prev) => ({ ...prev, [key]: event.target.value }))}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700"
              >
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contactDisplayName(contact)}
                    {contact.email ? ` (${contact.email})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {ids.survivorId === ids.mergedId && (
          <p className="text-sm text-amber-700 dark:text-amber-300">Pick two different Contacts.</p>
        )}
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <strong>{nameOf(ids.mergedId)}</strong> will be merged into <strong>{nameOf(ids.survivorId)}</strong>.
          Use this when both are the same person.{" "}
          <button
            type="button"
            className="text-blue-600 underline dark:text-blue-400"
            onClick={() => setIds({ survivorId: ids.mergedId, mergedId: ids.survivorId })}
          >
            Keep the other one instead
          </button>
        </p>
        {!current && !previewFetcher.data?.error && ids.survivorId !== ids.mergedId && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}
        {previewFetcher.data?.error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {previewFetcher.data.error}
          </p>
        )}
        {current && (
          <>
            {current.conflicts.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Choose which to keep</h3>
                {current.conflicts.map((conflict) => (
                  <fieldset key={conflict.field} className="grid grid-cols-[7rem_1fr_1fr] items-center gap-2">
                    <legend className="sr-only">{conflict.label}</legend>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{conflict.label}</span>
                    {(
                      [
                        ["survivor", conflict.survivorValue],
                        ["merged", conflict.mergedValue],
                      ] as const
                    ).map(([side, value]) => (
                      <label
                        key={side}
                        className={`cursor-pointer rounded border px-2 py-1 text-sm ${
                          choices[conflict.field] === side
                            ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40"
                            : "border-gray-200 dark:border-gray-700"
                        }`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={`contact-choice-${conflict.field}`}
                          checked={choices[conflict.field] === side}
                          onChange={() => setChoices((prev) => ({ ...prev, [conflict.field]: side }))}
                        />
                        {value}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            )}
            {current.autoFills.length > 0 && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Filled in: {current.autoFills.map((fill) => `${fill.label}: ${fill.value}`).join("; ")}
              </p>
            )}
            <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300">
              {current.retainedEmails.length > 0 && (
                <li>Emails kept as aliases: {current.retainedEmails.join(", ")}</li>
              )}
              {current.joinsOrganizations.length > 0 && (
                <li>Also joins: {current.joinsOrganizations.map((org) => org.name).join(", ")}</li>
              )}
              <li>{current.communications} logged communication(s) move to the kept Contact</li>
            </ul>
          </>
        )}
        {mergeFetcher.data?.error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {mergeFetcher.data.error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="danger" disabled={!current || ids.survivorId === ids.mergedId || mergeFetcher.state !== "idle"} onClick={submit}>
            Merge Contacts
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The people at this Organization, with the primary Contact first. */
export function ContactsSection({ contacts, duplicatePairs = [], canMerge = false, returnTo }: Props) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [merging, setMerging] = useState<{ survivorId: string; mergedId: string } | null>(null);
  const actionFetcher = useFetcher<{ error?: string }>();

  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800" aria-labelledby="contacts-heading">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-6 py-4 dark:border-gray-600 dark:bg-gray-700">
        <h3 id="contacts-heading" className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Contacts
        </h3>
        {editing !== "new" && (
          <Button size="sm" onClick={() => setEditing("new")} className="inline-flex items-center gap-1">
            <UserPlus className="h-4 w-4" aria-hidden="true" /> Add
          </Button>
        )}
      </div>
      <div className="space-y-3 p-6">
        {editing === "new" && <ContactForm onDone={() => setEditing(null)} />}
        {canMerge && duplicatePairs.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-medium">Possible duplicate Contacts</p>
            <ul className="mt-1 space-y-1">
              {duplicatePairs.map((pair) => {
                const a = contacts.find((c) => c.id === pair.a);
                const b = contacts.find((c) => c.id === pair.b);
                if (!a || !b) return null;
                return (
                  <li key={`${pair.a}-${pair.b}`} className="flex flex-wrap items-center gap-2">
                    {contactDisplayName(a)} and {contactDisplayName(b)} ({pair.reason === "email" ? "same email" : "same name"})
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setMerging(a.isPrimary || !b.isPrimary ? { survivorId: a.id, mergedId: b.id } : { survivorId: b.id, mergedId: a.id })
                      }
                    >
                      Review merge
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {actionFetcher.data?.error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {actionFetcher.data.error}
          </p>
        )}
        {contacts.length === 0 && editing !== "new" && (
          <p className="text-sm text-gray-500 dark:text-gray-400">No contacts yet.</p>
        )}
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {contacts.map((contact) =>
            editing === contact.id ? (
              <li key={contact.id} className="py-3">
                <ContactForm contact={contact} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={contact.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                    {contactDisplayName(contact)}
                    {contact.isPrimary && (
                      <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        <Star className="h-3 w-3" aria-hidden="true" /> Primary
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {[contact.title, contact.role].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {[contact.email, contact.phone].filter(Boolean).join(" · ") || "No email or phone"}
                  </p>
                  {contact.emails.filter((email) => email !== contact.email?.trim().toLowerCase()).length > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Also known as: {contact.emails.filter((email) => email !== contact.email?.trim().toLowerCase()).join(", ")}
                    </p>
                  )}
                  {contact.otherOrganizations.length > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Also at: {contact.otherOrganizations.map((org) => org.name).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(contact.id)}>
                    Edit
                  </Button>
                  {!contact.isPrimary && (
                    <actionFetcher.Form method="post">
                      <input type="hidden" name="intent" value="setPrimaryContact" />
                      <input type="hidden" name="contactId" value={contact.id} />
                      <Button size="sm" variant="secondary" type="submit">
                        Make primary
                      </Button>
                    </actionFetcher.Form>
                  )}
                  {contacts.length > 1 && (
                    <actionFetcher.Form
                      method="post"
                      onSubmit={(event) => {
                        if (!window.confirm(`Remove ${contactDisplayName(contact)} from this Organization?`)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="removeContact" />
                      <input type="hidden" name="contactId" value={contact.id} />
                      <Button size="sm" variant="secondary" type="submit">
                        Remove
                      </Button>
                    </actionFetcher.Form>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
        {canMerge && contacts.length > 1 && duplicatePairs.length === 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Same person listed twice?{" "}
            <button
              type="button"
              className="text-blue-600 underline dark:text-blue-400"
              onClick={() => setMerging({ survivorId: contacts[0].id, mergedId: contacts[1].id })}
            >
              Merge two Contacts
            </button>
          </p>
        )}
      </div>
      {merging && (
        <ContactMergeModal pair={merging} contacts={contacts} returnTo={returnTo} onClose={() => setMerging(null)} />
      )}
    </section>
  );
}
