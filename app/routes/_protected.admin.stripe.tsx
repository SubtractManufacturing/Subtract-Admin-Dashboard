import { useState } from "react";
import {
  json,
  redirect,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { isStripePaymentLinksEnabled } from "~/lib/featureFlags";
import { isStripeConfigured } from "~/lib/stripe.server";
import {
  getStripeDefaults,
  setDeveloperSetting,
  STRIPE_SETTINGS,
} from "~/lib/developerSettings";
import Button from "~/components/shared/Button";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);

  if (userDetails.role !== "Admin" && userDetails.role !== "Dev") {
    return withAuthHeaders(redirect("/"), headers);
  }

  const stripeFeatureEnabled = await isStripePaymentLinksEnabled();
  if (!stripeFeatureEnabled) {
    return withAuthHeaders(redirect("/admin"), headers);
  }

  const [stripeDefaults, stripeConfiguredFlag] = await Promise.all([
    getStripeDefaults(),
    Promise.resolve(isStripeConfigured()),
  ]);

  return withAuthHeaders(
    json({
      stripeDefaults,
      stripeConfigured: stripeConfiguredFlag,
    }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);

  if (userDetails.role !== "Admin" && userDetails.role !== "Dev") {
    return withAuthHeaders(redirect("/"), headers);
  }

  const stripeFeatureEnabled = await isStripePaymentLinksEnabled();
  if (!stripeFeatureEnabled) {
    return withAuthHeaders(redirect("/admin"), headers);
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "saveStripeDefaults") {
    const collectBilling = formData.get("collectBillingAddress") === "on";
    const collectShipping = formData.get("collectShippingAddress") === "on";
    const requirePhone = formData.get("requirePhone") === "on";
    const limitPayments = formData.get("limitPayments") === "on";
    const limitCount = formData.get("limitPaymentsCount") as string;

    await Promise.all([
      setDeveloperSetting(
        STRIPE_SETTINGS.COLLECT_BILLING_ADDRESS,
        collectBilling ? "true" : "false"
      ),
      setDeveloperSetting(
        STRIPE_SETTINGS.COLLECT_SHIPPING_ADDRESS,
        collectShipping ? "true" : "false"
      ),
      setDeveloperSetting(
        STRIPE_SETTINGS.REQUIRE_PHONE,
        requirePhone ? "true" : "false"
      ),
      setDeveloperSetting(
        STRIPE_SETTINGS.LIMIT_PAYMENTS,
        limitPayments ? "true" : "false"
      ),
      setDeveloperSetting(
        STRIPE_SETTINGS.LIMIT_PAYMENTS_COUNT,
        limitCount || "1"
      ),
    ]);

    return withAuthHeaders(json({ success: true }), headers);
  }

  return withAuthHeaders(json({ error: "Invalid action" }, { status: 400 }), headers);
}

export default function AdminStripe() {
  const { stripeDefaults, stripeConfigured } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [limitEnabled, setLimitEnabled] = useState(stripeDefaults.limitPayments);
  const isSaving = fetcher.state !== "idle";

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Stripe
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure Stripe payment link defaults.
        </p>
      </div>

      <div className="max-w-2xl rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          Payment Link Defaults
        </h2>

        {/* Status indicators */}
        <div className="space-y-2 mb-6 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Currency</span>
            <span className="font-medium text-gray-900 dark:text-white">
              USD
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">API Key</span>
            <span
              className={
                stripeConfigured
                  ? "font-medium text-green-600 dark:text-green-400"
                  : "font-medium text-red-600 dark:text-red-400"
              }
            >
              {stripeConfigured ? "Configured" : "Not configured"}
            </span>
          </div>
        </div>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="saveStripeDefaults" />

          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="collectBillingAddress"
                defaultChecked={stripeDefaults.collectBillingAddress}
                className="h-4 w-4 rounded border-gray-300 text-[#840606] focus:ring-[#840606] dark:border-slate-600 dark:bg-slate-700"
              />
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Collect billing address
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Require customers to provide their billing address at checkout
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="collectShippingAddress"
                defaultChecked={stripeDefaults.collectShippingAddress}
                className="h-4 w-4 rounded border-gray-300 text-[#840606] focus:ring-[#840606] dark:border-slate-600 dark:bg-slate-700"
              />
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Collect shipping address
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Require customers to provide their shipping address at
                  checkout
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="requirePhone"
                defaultChecked={stripeDefaults.requirePhone}
                className="h-4 w-4 rounded border-gray-300 text-[#840606] focus:ring-[#840606] dark:border-slate-600 dark:bg-slate-700"
              />
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Require phone number
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Require customers to submit a phone number at checkout
                </p>
              </div>
            </label>

            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                name="limitPayments"
                checked={limitEnabled}
                onChange={(e) => setLimitEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-[#840606] focus:ring-[#840606] dark:border-slate-600 dark:bg-slate-700 cursor-pointer"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Limit payments
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Restrict the number of completed payments per link
                </p>
                {limitEnabled && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      name="limitPaymentsCount"
                      min="1"
                      max="999"
                      defaultValue={stripeDefaults.limitPaymentsCount}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-[#840606] focus:ring-[#840606] dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      payment(s) per link
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
            {fetcher.data &&
              typeof fetcher.data === "object" &&
              "success" in fetcher.data ? (
                <span className="text-sm text-green-600 dark:text-green-400">
                  Settings saved
                </span>
              ) : null}
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
