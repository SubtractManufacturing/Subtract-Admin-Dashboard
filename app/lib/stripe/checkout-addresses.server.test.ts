import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  },
}));

vi.mock("~/lib/customers", () => ({
  getCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));

vi.mock("~/lib/stripe.server", () => ({
  getStripeClient: vi.fn(() => null),
}));

vi.mock("~/lib/featureFlags", () => ({
  isStripePaymentLinksEnabled: vi.fn(() => Promise.resolve(false)),
}));

import {
  mapStripeSessionToSnapshot,
  addressesEqual,
  phonesEqual,
  customerAddressesFullyBlank,
  snapshotToPartialCustomerInput,
  type CheckoutSessionAddressSource,
} from "./checkout-addresses.server";
import type { Customer } from "~/lib/db/schema";
import { isAddressMeaningfullyEmpty } from "~/lib/address-utils";

describe("checkout-addresses.server", () => {
  it("isAddressMeaningfullyEmpty ignores country-only rows", () => {
    expect(
      isAddressMeaningfullyEmpty({
        line1: null,
        city: null,
        state: null,
        postalCode: null,
        country: "US",
      })
    ).toBe(true);
  });

  it("mapStripeSessionToSnapshot reads shipping from collected_information (Stripe API)", () => {
    const snap = mapStripeSessionToSnapshot({
      customer_details: {
        email: "j@example.com",
        phone: "(530) 383-9339",
        address: {
          line1: "875 West Southwood Drive",
          line2: null,
          city: "Woodland",
          state: "CA",
          postal_code: "95695",
          country: "US",
        },
      },
      collected_information: {
        business_name: null,
        individual_name: null,
        shipping_details: {
          name: "Jacob Munoz",
          address: {
            line1: "5595 Shannon Ave SE",
            line2: null,
            city: "Salem",
            state: "OR",
            postal_code: "97306",
            country: "US",
          },
        },
      },
    } as CheckoutSessionAddressSource);

    expect(snap.billing?.city).toBe("Woodland");
    expect(snap.shipping?.city).toBe("Salem");
    expect(snap.shipping?.line1).toBe("5595 Shannon Ave SE");
    expect(snap.billing?.line1).toBe("875 West Southwood Drive");
  });

  it("mapStripeSessionToSnapshot prefers collected_information over legacy shipping_details when both set", () => {
    const snap = mapStripeSessionToSnapshot({
      customer_details: {
        address: {
          line1: "1 Bill St",
          city: "Austin",
          state: "TX",
          postal_code: "78701",
          country: "US",
        },
      },
      shipping_details: {
        address: {
          line1: "9 Legacy Ship",
          city: "Dallas",
          state: "TX",
          postal_code: "75201",
          country: "US",
        },
      },
      collected_information: {
        business_name: null,
        individual_name: null,
        shipping_details: {
          name: "X",
          address: {
            line1: "2 Collected Ship",
            city: "Salem",
            state: "OR",
            postal_code: "97306",
            country: "US",
          },
        },
      },
    } as CheckoutSessionAddressSource);

    expect(snap.shipping?.line1).toBe("2 Collected Ship");
  });

  it("mapStripeSessionToSnapshot prefers shipping_details when present", () => {
    const snap = mapStripeSessionToSnapshot({
      customer_details: {
        email: "a@b.com",
        phone: "+1 555-0100",
        address: {
          line1: "1 Main",
          line2: "Suite 2",
          city: "Austin",
          state: "TX",
          postal_code: "78701",
          country: "US",
        },
      },
      shipping_details: {
        address: {
          line1: "9 Ship",
          line2: null,
          city: "Dallas",
          state: "TX",
          postal_code: "75201",
          country: "US",
        },
      },
    } as CheckoutSessionAddressSource);

    expect(snap.phone).toBe("+1 555-0100");
    expect(snap.billing?.line1).toBe("1 Main");
    expect(snap.shipping?.line1).toBe("9 Ship");
  });

  it("mapStripeSessionToSnapshot clones billing into shipping when only billing present", () => {
    const snap = mapStripeSessionToSnapshot({
      customer_details: {
        phone: "+1 555-0100",
        address: {
          line1: "5595 Shannon Avenue Southeast",
          line2: null,
          city: "Salem",
          state: "OR",
          postal_code: "97306",
          country: "US",
        },
      },
      shipping_details: null,
    } as CheckoutSessionAddressSource);
    expect(snap.billing?.city).toBe("Salem");
    expect(snap.shipping?.line1).toBe("5595 Shannon Avenue Southeast");
    expect(snap.shipping?.city).toBe("Salem");
  });

  it("addressesEqual normalizes comparison", () => {
    expect(
      addressesEqual(
        {
          line1: " 1 Main ",
          city: "austin",
          state: "tx",
          postalCode: "78701",
        },
        {
          line1: "1 main",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
        }
      )
    ).toBe(true);
  });

  it("phonesEqual strips non-digits", () => {
    expect(phonesEqual("(555) 010-2345", "5550102345")).toBe(true);
  });

  it("customerAddressesFullyBlank is true only when both empty", () => {
    const blank = {
      id: 1,
      billingAddressLine1: null,
      billingCity: null,
      billingState: null,
      billingPostalCode: null,
      shippingAddressLine1: null,
      shippingCity: null,
    } as unknown as Customer;

    const withShip = {
      ...blank,
      shippingAddressLine1: "x",
    } as unknown as Customer;

    expect(customerAddressesFullyBlank(blank)).toBe(true);
    expect(customerAddressesFullyBlank(withShip)).toBe(false);
  });

  it("customerAddressesFullyBlank is true when only default countries on file", () => {
    const countryOnly = {
      id: 1,
      billingAddressLine1: null,
      billingCity: null,
      billingState: null,
      billingPostalCode: null,
      billingCountry: "US",
      shippingAddressLine1: null,
      shippingCity: null,
      shippingState: null,
      shippingPostalCode: null,
      shippingCountry: "US",
    } as unknown as Customer;
    expect(customerAddressesFullyBlank(countryOnly)).toBe(true);
  });

  it("snapshotToPartialCustomerInput builds customer patch", () => {
    const patch = snapshotToPartialCustomerInput({
      billing: {
        line1: "1 B",
        line2: null,
        city: "C",
        state: "S",
        postalCode: "12345",
        country: "US",
      },
      shipping: null,
      phone: "+15550001111",
    });

    expect(patch.billingAddressLine1).toBe("1 B");
    expect(patch.phone).toBe("+15550001111");
    expect(patch.shippingAddressLine1).toBeUndefined();
  });
});
