import { json, unstable_parseMultipartFormData, type ActionFunctionArgs, type LoaderFunctionArgs, type UploadHandler } from "@remix-run/node";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { createQuoteWithParts, type QuoteInput, type QuoteEventContext } from "~/lib/quotes";
import { createCustomer, getCustomers } from "~/lib/customers";
import { createEvent } from "~/lib/events";
import { useLoaderData, useNavigate, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import Breadcrumbs from "~/components/Breadcrumbs";
import NewQuoteModal from "~/components/quotes/NewQuoteModal";
import { useState } from "react";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  const customers = await getCustomers();

  return withAuthHeaders(
    json({ user, userDetails, customers }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);

  try {
    const files = new Map<string, { buffer: Buffer; fileName: string }>();

    const uploadHandler: UploadHandler = async ({ filename, data }) => {
      if (!filename || !data) {
        if (data && typeof data !== 'string') {
          const chunks = [];
          for await (const chunk of data) {
            chunks.push(chunk);
          }
          return Buffer.concat(chunks).toString('utf-8');
        }
        return data || "";
      }

      let buffer: Buffer;
      if (data instanceof Buffer) {
        buffer = data;
      } else {
        const chunks = [];
        for await (const chunk of data) {
          chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
      }

      const fileKey = `${Date.now()}-${filename}`;
      files.set(fileKey, { buffer, fileName: filename });
      return fileKey;
    };

    const formData = await unstable_parseMultipartFormData(request, uploadHandler);

    const context: QuoteEventContext = {
      userId: user?.id,
      userEmail: user?.email || userDetails?.name || undefined,
    };

    let customerId: number;
    const shouldCreateCustomer = formData.get("createCustomer") === "true";

    if (shouldCreateCustomer) {
      const customerData = {
        displayName: formData.get("customerName") as string,
        email: formData.get("customerEmail") as string,
        phone: formData.get("customerPhone") as string || null
      };

      if (!customerData.displayName || !customerData.email) {
        throw new Error("Customer name and email are required");
      }

      const newCustomer = await createCustomer(customerData);
      if (!newCustomer?.id) {
        throw new Error("Failed to create customer");
      }

      customerId = newCustomer.id;

      await createEvent({
        eventCategory: "system",
        eventType: "customer_created",
        entityType: "customer",
        entityId: customerId.toString(),
        title: "Customer Created",
        description: `Customer ${newCustomer.displayName} created from quote`,
        metadata: {
          customerName: newCustomer.displayName,
          createdFrom: "quote_creation"
        },
        userId: user?.id,
        userEmail: user?.email || userDetails?.name,
      });
    } else {
      const idString = formData.get("customerId") as string;
      if (!idString) throw new Error("Customer ID is required");
      customerId = parseInt(idString, 10);
      if (isNaN(customerId)) throw new Error("Invalid customer ID");
    }

    const quoteData: QuoteInput = {
      customerId,
      vendorId: null,
      status: "RFQ",
      expirationDays: 14,
      createdById: user?.id,
    };

    const partCount = Array.from(formData.keys())
      .filter(key => key.startsWith("parts[") && key.includes("][file]"))
      .length;

    const partsData = [];
    for (let i = 0; i < partCount; i++) {
      const fileKey = formData.get(`parts[${i}][file]`) as string;
      const file = files.get(fileKey);

      // Get drawings for this part
      const drawings: Array<{ buffer: Buffer; fileName: string }> = [];
      let drawingIndex = 0;
      while (formData.get(`parts[${i}][drawings][${drawingIndex}]`)) {
        const drawingKey = formData.get(`parts[${i}][drawings][${drawingIndex}]`) as string;
        const drawing = files.get(drawingKey);
        if (drawing) {
          drawings.push(drawing);
        }
        drawingIndex++;
      }

      partsData.push({
        file: file?.buffer,
        fileName: file?.fileName,
        partName: formData.get(`parts[${i}][name]`) as string,
        material: formData.get(`parts[${i}][material]`) as string,
        tolerances: formData.get(`parts[${i}][tolerances]`) as string,
        surfaceFinish: formData.get(`parts[${i}][surfaceFinish]`) as string,
        quantity: parseInt(formData.get(`parts[${i}][quantity]`) as string) || 1,
        notes: formData.get(`parts[${i}][notes]`) as string,
        drawings: drawings.length > 0 ? drawings : undefined,
      });
    }

    const result = await createQuoteWithParts(quoteData, partsData, context);

    if (!result.success) {
      throw new Error(result.error || "Failed to create quote");
    }

    return json({ success: true, quoteId: result.quoteId });
  } catch (error) {
    console.error("Error creating quote with parts:", error);
    return json({ error: "Failed to create quote" }, { status: 500 });
  }
}

export default function NewQuotePage() {
  const { user, userDetails, customers } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(true);

  const handleClose = () => {
    setIsModalOpen(false);
    navigate("/quotes");
  };

  const handleSuccess = () => {
    navigate("/quotes");
  };

  const breadcrumbItems = [
    { label: "Quotes", href: "/quotes" },
    { label: "New Quote", href: "/quotes/new" }
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs items={breadcrumbItems} />

        <NewQuoteModal
          isOpen={isModalOpen}
          onClose={handleClose}
          customers={customers}
          onSuccess={handleSuccess}
        />
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
            {error.status} {error.statusText}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {error.data || "An error occurred while creating the quote."}
          </p>
          <a
            href="/quotes"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Back to Quotes
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
          Unexpected Error
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          {error instanceof Error ? error.message : "An unexpected error occurred while creating the quote."}
        </p>
        <a
          href="/quotes"
          className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Back to Quotes
        </a>
      </div>
    </div>
  );
}