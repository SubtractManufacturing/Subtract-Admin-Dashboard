import { useFetcher } from "@remix-run/react";
import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";

import Button from "~/components/shared/Button";
import { InputField } from "~/components/shared/FormField";
import { formatAddressLines } from "~/lib/organizations/profile";
import type { AddressRecord } from "~/lib/organizations/types";

type Props = {
  addresses: AddressRecord[];
  /** The account's billing address, if it has one. */
  billingAddressId: string | null;
  /** "Customer" or "Vendor", for labels. */
  accountLabel: string;
};

function AddressForm({ address, onDone }: { address?: AddressRecord; onDone: () => void }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onDone();
  }, [fetcher.state, fetcher.data, onDone]);
  return (
    <fetcher.Form method="post" className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-700">
      <input type="hidden" name="intent" value={address ? "updateAddress" : "addAddress"} />
      {address && <input type="hidden" name="addressId" value={address.id} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <InputField label="Label" name="label" defaultValue={address?.label ?? ""} placeholder="Main plant, Warehouse…" />
        <InputField label="Address line 1" name="line1" defaultValue={address?.line1 ?? ""} />
        <InputField label="Address line 2" name="line2" defaultValue={address?.line2 ?? ""} />
        <InputField label="City" name="city" defaultValue={address?.city ?? ""} />
        <InputField label="State" name="state" defaultValue={address?.state ?? ""} />
        <InputField label="Postal code" name="postalCode" defaultValue={address?.postalCode ?? ""} />
        <InputField label="Country" name="country" defaultValue={address?.country ?? "US"} />
      </div>
      {!address && (
        <div className="flex flex-wrap gap-4 text-sm text-gray-700 dark:text-gray-300">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="makeDefaultShipping" value="true" className="rounded border-gray-300" />
            Default shipping address
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="useForBilling" value="true" className="rounded border-gray-300" />
            Use for billing
          </label>
        </div>
      )}
      {fetcher.data?.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {fetcher.data.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={fetcher.state !== "idle"}>
          {address ? "Save" : "Add address"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </fetcher.Form>
  );
}

/**
 * Every address of the Organization. One is the default shipping address used
 * by Quotes and Orders; the account bills to one of them.
 */
export function AddressesSection({ addresses, billingAddressId, accountLabel }: Props) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const actionFetcher = useFetcher<{ error?: string }>();

  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-md dark:border-gray-700 dark:bg-gray-800" aria-labelledby="addresses-heading">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-6 py-4 dark:border-gray-600 dark:bg-gray-700">
        <h3 id="addresses-heading" className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Addresses
        </h3>
        {editing !== "new" && (
          <Button size="sm" onClick={() => setEditing("new")} className="inline-flex items-center gap-1">
            <MapPin className="h-4 w-4" aria-hidden="true" /> Add
          </Button>
        )}
      </div>
      <div className="space-y-3 p-6">
        {editing === "new" && <AddressForm onDone={() => setEditing(null)} />}
        {actionFetcher.data?.error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {actionFetcher.data.error}
          </p>
        )}
        {addresses.length === 0 && editing !== "new" && (
          <p className="text-sm text-gray-500 dark:text-gray-400">No addresses yet.</p>
        )}
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {addresses.map((address) =>
            editing === address.id ? (
              <li key={address.id} className="py-3">
                <AddressForm address={address} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={address.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
                    {address.label || "Address"}
                    {address.isDefaultShipping && (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                        Default shipping
                      </span>
                    )}
                    {address.id === billingAddressId && (
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                        {accountLabel} billing
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{formatAddressLines(address) || "--"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(address.id)}>
                    Edit
                  </Button>
                  {!address.isDefaultShipping && (
                    <actionFetcher.Form method="post">
                      <input type="hidden" name="intent" value="setDefaultShipping" />
                      <input type="hidden" name="addressId" value={address.id} />
                      <Button size="sm" variant="secondary" type="submit">
                        Ship here by default
                      </Button>
                    </actionFetcher.Form>
                  )}
                  {address.id !== billingAddressId && (
                    <actionFetcher.Form method="post">
                      <input type="hidden" name="intent" value="setBillingAddress" />
                      <input type="hidden" name="addressId" value={address.id} />
                      <Button size="sm" variant="secondary" type="submit">
                        Bill here
                      </Button>
                    </actionFetcher.Form>
                  )}
                  {address.id !== billingAddressId && (
                    <actionFetcher.Form
                      method="post"
                      onSubmit={(event) => {
                        if (!window.confirm("Remove this address?")) event.preventDefault();
                      }}
                    >
                      <input type="hidden" name="intent" value="archiveAddress" />
                      <input type="hidden" name="addressId" value={address.id} />
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
      </div>
    </section>
  );
}
