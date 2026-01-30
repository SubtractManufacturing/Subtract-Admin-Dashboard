import { json } from "@remix-run/node";
import { useLoaderData, useFetcher, useNavigate, useRevalidator } from "@remix-run/react";
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import {
  getOrdersWithRelations,
  getOrder,
  createOrder,
  updateOrder,
  archiveOrder,
  checkOrderNumberExists,
  reassignOrderNumber,
} from "~/lib/orders";
import { getCustomers } from "~/lib/customers";
import type { Customer } from "~/lib/customers";
import { getVendors } from "~/lib/vendors";
import type { Vendor } from "~/lib/vendors";
import type { OrderWithRelations, OrderInput, OrderEventContext } from "~/lib/orders";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getNextOrderNumber } from "~/lib/number-generator";

import SearchHeader from "~/components/SearchHeader";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";
import { InputField, SelectField } from "~/components/shared/FormField";
import { tableStyles, statusStyles } from "~/utils/tw-styles";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  try {
    const [orders, customers, vendors] = await Promise.all([
      getOrdersWithRelations(),
      getCustomers(),
      getVendors(),
    ]);
    return withAuthHeaders(
      json({ orders, customers, vendors, user, userDetails }),
      headers
    );
  } catch (error) {
    console.error("Orders loader error:", error);
    return withAuthHeaders(
      json({
        orders: [],
        customers: [],
        vendors: [],
        user,
        userDetails,
      }),
      headers
    );
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const eventContext: OrderEventContext = {
    userId: user?.id,
    userEmail: user?.email || userDetails?.name || undefined,
  };

  try {
    switch (intent) {
      case "generateOrderNumber": {
        const nextOrderNumber = await getNextOrderNumber();
        return json({ orderNumber: nextOrderNumber });
      }
      case "checkOrderNumber": {
        const orderNumber = formData.get("orderNumber") as string;
        if (!orderNumber) {
          return json({ exists: false });
        }
        const exists = await checkOrderNumberExists(orderNumber);
        return json({ exists });
      }
      case "create": {
        const orderNumber = (formData.get("orderNumber") as string) || null;

        // Check if order number exists before creating
        if (orderNumber) {
          const exists = await checkOrderNumberExists(orderNumber);
          if (exists) {
            return json(
              { error: "Order number already exists" },
              { status: 400 }
            );
          }
        }

        // For new orders, we don't have a total yet, so store "0"
        // Vendor pay will be calculated when line items are added
        const orderData: OrderInput = {
          orderNumber,
          customerId: formData.get("customerId")
            ? parseInt(formData.get("customerId") as string)
            : null,
          vendorId: formData.get("vendorId")
            ? parseInt(formData.get("vendorId") as string)
            : null,
          status: (formData.get("status") as OrderInput["status"]) || "Pending",
          vendorPay: "0", // Will be set properly when line items are added
          shipDate: formData.get("shipDate")
            ? new Date(formData.get("shipDate") as string)
            : null,
        };
        await createOrder(orderData, eventContext);
        return json({ success: true });
      }
      case "update": {
        const orderId = parseInt(formData.get("orderId") as string);
        const vendorPayPercentage =
          parseFloat(formData.get("vendorPayPercentage") as string) || 70;

        // Get the current order to calculate vendor pay amount from percentage
        const order = await getOrder(orderId);
        if (!order) {
          return json({ error: "Order not found" }, { status: 404 });
        }

        // Calculate vendor pay amount from percentage and total
        const orderTotal = parseFloat(order.totalPrice || "0");
        const vendorPayAmount = (orderTotal * vendorPayPercentage / 100).toFixed(2);

        const orderData: OrderInput = {
          customerId: formData.get("customerId")
            ? parseInt(formData.get("customerId") as string)
            : null,
          vendorId: formData.get("vendorId")
            ? parseInt(formData.get("vendorId") as string)
            : null,
          status: (formData.get("status") as OrderInput["status"]) || "Pending",
          vendorPay: vendorPayAmount, // Store as dollar amount
          shipDate: formData.get("shipDate")
            ? new Date(formData.get("shipDate") as string)
            : null,
        };
        await updateOrder(orderId, orderData, eventContext);
        return json({ success: true });
      }
      case "delete": {
        const orderId = parseInt(formData.get("orderId") as string);
        await archiveOrder(orderId, eventContext);
        return json({ success: true });
      }
      case "reassignOrderNumber": {
        const orderId = parseInt(formData.get("orderId") as string);
        const newOrderNumber = formData.get("newOrderNumber") as string;
        
        if (!newOrderNumber) {
          return json({ error: "Order number is required" }, { status: 400 });
        }
        
        const result = await reassignOrderNumber(orderId, newOrderNumber, eventContext);
        if (result.success) {
          return json({ success: true, orderNumber: result.orderNumber });
        } else {
          return json({ error: result.error }, { status: 400 });
        }
      }
      default:
        return json({ error: "Invalid intent" }, { status: 400 });
    }
  } catch (error) {
    console.error("Order action error:", error);
    return json({ error: "Failed to process order action" }, { status: 500 });
  }
}

export default function Orders() {
  const { orders, customers, vendors, user, userDetails } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OrderWithRelations | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [orderNumberError, setOrderNumberError] = useState("");
  const [isCheckingOrderNumber, setIsCheckingOrderNumber] = useState(false);
  const [vendorPayPercentage, setVendorPayPercentage] = useState(70);
  const [newOrderNumber, setNewOrderNumber] = useState("");
  const [isReassigningOrderNumber, setIsReassigningOrderNumber] = useState(false);
  const [reassignError, setReassignError] = useState("");

  // Handle fetcher response
  useEffect(() => {
    if (fetcher.data && typeof fetcher.data === "object") {
      if ("orderNumber" in fetcher.data && !("success" in fetcher.data)) {
        // This is a response from generateOrderNumber, not reassign
        setOrderNumber(fetcher.data.orderNumber as string);
        setOrderNumberError("");
      }
      if ("exists" in fetcher.data && fetcher.data.exists === true) {
        setOrderNumberError("This order number already exists");
      }
      if ("error" in fetcher.data) {
        // Set error in appropriate field based on context
        if (isReassigningOrderNumber) {
          setReassignError(fetcher.data.error as string);
        } else {
          setOrderNumberError(fetcher.data.error as string);
        }
      }
      // Close modal on successful create/update/reassign
      if ("success" in fetcher.data && fetcher.data.success === true) {
        setModalOpen(false);
        // Reset form state
        setEditingOrder(null);
        setOrderNumber("");
        setOrderNumberError("");
        setVendorPayPercentage(70);
        setNewOrderNumber("");
        setIsReassigningOrderNumber(false);
        setReassignError("");
        // Reload the page data
        revalidator.revalidate();
      }
    }
  }, [fetcher.data, revalidator, isReassigningOrderNumber]);

  const filteredOrders = orders.filter((order: OrderWithRelations) => {
    const query = searchQuery.toLowerCase();
    return (
      order.orderNumber?.toLowerCase().includes(query) ||
      order.customer?.displayName?.toLowerCase().includes(query) ||
      order.vendor?.displayName?.toLowerCase().includes(query) ||
      order.status?.toLowerCase().includes(query)
    );
  });

  const handleAdd = () => {
    setEditingOrder(null);
    setOrderNumber("");
    setOrderNumberError("");
    setVendorPayPercentage(70);
    setModalOpen(true);
  };

  const handleEdit = (order: OrderWithRelations) => {
    setEditingOrder(order);
    setOrderNumber(order.orderNumber);
    setOrderNumberError("");
    // vendorPay now stores a dollar amount - calculate percentage for UI
    const vendorPayAmount = parseFloat(order.vendorPay || "0");
    const orderTotal = parseFloat(order.totalPrice || "0");
    const percentage = orderTotal > 0 ? (vendorPayAmount / orderTotal) * 100 : 70;
    setVendorPayPercentage(percentage);
    setNewOrderNumber("");
    setIsReassigningOrderNumber(false);
    setReassignError("");
    setModalOpen(true);
  };

  const handleGenerateOrderNumber = () => {
    fetcher.submit({ intent: "generateOrderNumber" }, { method: "POST" });
  };

  const handleOrderNumberChange = (value: string) => {
    setOrderNumber(value);
    setOrderNumberError("");

    // Debounce the check
    if (value) {
      setIsCheckingOrderNumber(true);
      const timeoutId = setTimeout(() => {
        fetcher.submit(
          { intent: "checkOrderNumber", orderNumber: value },
          { method: "POST" }
        );
        setIsCheckingOrderNumber(false);
      }, 500);

      return () => clearTimeout(timeoutId);
    }
  };

  const handleDelete = (orderId: number) => {
    if (confirm("Are you sure you want to archive this order?")) {
      fetcher.submit(
        { intent: "delete", orderId: orderId.toString() },
        { method: "POST" }
      );
    }
  };

  const handleGenerateNewOrderNumber = () => {
    setIsReassigningOrderNumber(true);
    setReassignError("");
    fetcher.submit({ intent: "generateOrderNumber" }, { method: "POST" });
  };

  // Effect to capture generated order number for reassignment
  useEffect(() => {
    if (
      isReassigningOrderNumber &&
      fetcher.data &&
      typeof fetcher.data === "object" &&
      "orderNumber" in fetcher.data &&
      !("success" in fetcher.data)
    ) {
      setNewOrderNumber(fetcher.data.orderNumber as string);
    }
  }, [fetcher.data, isReassigningOrderNumber]);

  const handleReassignOrderNumber = () => {
    if (!editingOrder || !newOrderNumber) return;
    
    if (confirm(`Are you sure you want to change the order number from ${editingOrder.orderNumber} to ${newOrderNumber}?`)) {
      fetcher.submit(
        {
          intent: "reassignOrderNumber",
          orderId: editingOrder.id.toString(),
          newOrderNumber,
        },
        { method: "POST" }
      );
    }
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return "--";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(parseFloat(amount));
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "--";
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const getStatusStyle = (status: string) => {
    switch (status.toLowerCase()) {
      case "pending":
        return statusStyles.pending;
      case "in_production":
        return statusStyles.inProduction;
      case "completed":
        return statusStyles.completed;
      case "cancelled":
        return statusStyles.cancelled;
      case "archived":
        return statusStyles.archived;
      default:
        return "";
    }
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "In_Production":
        return "In Production";
      default:
        return status;
    }
  };

  return (
    <div className="max-w-[1920px] mx-auto">
      <SearchHeader
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Orders" }]}
        onSearch={setSearchQuery}
      />

      <div className="px-10 py-8">
          <div className="flex justify-between items-center mb-5">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">
              Orders ({filteredOrders.length})
            </h2>
            <Button onClick={handleAdd}>Add Order</Button>
          </div>

          <table className={tableStyles.container}>
            <thead className={tableStyles.header}>
              <tr>
                <th className={tableStyles.headerCell}>Order #</th>
                <th className={tableStyles.headerCell}>Customer</th>
                <th className={tableStyles.headerCell}>Vendor</th>
                <th className={tableStyles.headerCell}>Status</th>
                <th className={tableStyles.headerCell}>Total Price</th>
                <th className={tableStyles.headerCell}>Vendor Pay</th>
                <th className={tableStyles.headerCell}>Ship Date</th>
                <th className={tableStyles.headerCell}>Date Created</th>
                <th className={tableStyles.headerCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order: OrderWithRelations) => (
                <tr
                  key={order.id}
                  className={`${tableStyles.row} cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800`}
                  onClick={() => navigate(`/orders/${order.orderNumber}`)}
                >
                  <td className={tableStyles.cell}>{order.orderNumber}</td>
                  <td className={tableStyles.cell}>
                    {order.customer?.id ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/customers/${order.customer!.id}`);
                        }}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                      >
                        {order.customer.displayName}
                      </button>
                    ) : (
                      <span>{order.customer?.displayName || "--"}</span>
                    )}
                  </td>
                  <td className={tableStyles.cell}>
                    {order.vendor?.id ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/vendors/${order.vendor!.id}`);
                        }}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                      >
                        {order.vendor.displayName}
                      </button>
                    ) : (
                      <span>{order.vendor?.displayName || "--"}</span>
                    )}
                  </td>
                  <td
                    className={`${tableStyles.cell} ${
                      statusStyles.base
                    } ${getStatusStyle(order.status)}`}
                  >
                    {getStatusDisplay(order.status)}
                  </td>
                  <td className={tableStyles.cell}>
                    {formatCurrency(
                      order.lineItems
                        ?.reduce(
                          (sum, item) =>
                            sum +
                            item.quantity * parseFloat(item.unitPrice || "0"),
                          0
                        )
                        .toString() || "0"
                    )}
                  </td>
                  <td className={tableStyles.cell}>
                    {(() => {
                      // vendorPay is now stored as a dollar amount
                      const vendorPayAmount = parseFloat(order.vendorPay || "0");
                      const total = parseFloat(order.totalPrice || "0");
                      const percentage = total > 0 ? (vendorPayAmount / total) * 100 : 0;

                      if (vendorPayAmount > 0) {
                        return `${formatCurrency(
                          vendorPayAmount.toString()
                        )} (${percentage.toFixed(1)}%)`;
                      }
                      return "--";
                    })()}
                  </td>
                  <td className={tableStyles.cell}>
                    {formatDate(order.shipDate)}
                  </td>
                  <td className={tableStyles.cell}>
                    {formatDate(order.createdAt)}
                  </td>
                  <td className={tableStyles.cell}>
                    <div className="flex space-x-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(order);
                        }}
                        className="p-1.5 text-white bg-blue-600 rounded hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors duration-150"
                        title="Quick Edit"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          fill="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(order.id);
                        }}
                        className="p-1.5 text-white bg-red-600 rounded hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition-colors duration-150"
                        title="Archive"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          fill="currentColor"
                          viewBox="0 0 16 16"
                        >
                          <path d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15h9.286zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1zM.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8H.8z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingOrder ? "Quick Edit" : "Add New Order"}
      >
        <fetcher.Form 
          method="post" 
          className="space-y-4"
          onSubmit={(e) => {
            // Form will submit normally, just ensuring it works with Enter key
            if (!editingOrder && orderNumberError) {
              e.preventDefault();
            }
          }}
        >
          <input
            type="hidden"
            name="intent"
            value={editingOrder ? "update" : "create"}
          />
          {editingOrder && (
            <input type="hidden" name="orderId" value={editingOrder.id} />
          )}

          {/* Show order number reassignment section when editing */}
          {editingOrder && (
            <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Current Order Number
                </span>
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {editingOrder.orderNumber}
                </span>
              </div>
              
              {!isReassigningOrderNumber ? (
                <button
                  type="button"
                  onClick={handleGenerateNewOrderNumber}
                  disabled={fetcher.state === "submitting"}
                  className="w-full mt-2 px-3 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z" />
                    <path
                      fillRule="evenodd"
                      d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"
                    />
                  </svg>
                  Assign New Order Number
                </button>
              ) : (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">New:</span>
                    <input
                      type="text"
                      value={newOrderNumber}
                      onChange={(e) => setNewOrderNumber(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
                      placeholder="Generating..."
                    />
                  </div>
                  {reassignError && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {reassignError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsReassigningOrderNumber(false);
                        setNewOrderNumber("");
                        setReassignError("");
                      }}
                      className="flex-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors duration-150"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleReassignOrderNumber}
                      disabled={!newOrderNumber || fetcher.state === "submitting"}
                      className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Confirm Change
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!editingOrder && (
            <div>
              <label
                htmlFor="orderNumber"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Order Number
              </label>
              <div className="relative">
                <input
                  id="orderNumber"
                  type="text"
                  name="orderNumber"
                  value={orderNumber}
                  onChange={(e) => handleOrderNumberChange(e.target.value)}
                  placeholder="Enter order number or click to generate"
                  className={`w-full px-3 py-2 pr-12 border rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100 ${
                    orderNumberError
                      ? "border-red-500 dark:border-red-500"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                />
                <button
                  type="button"
                  onClick={handleGenerateOrderNumber}
                  disabled={fetcher.state === "submitting"}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-white bg-blue-600 rounded hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Generate order number"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z" />
                    <path
                      fillRule="evenodd"
                      d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"
                    />
                  </svg>
                </button>
              </div>
              {orderNumberError && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {orderNumberError}
                </p>
              )}
              {isCheckingOrderNumber && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Checking availability...
                </p>
              )}
            </div>
          )}

          <SelectField
            label="Customer"
            name="customerId"
            defaultValue={editingOrder?.customerId?.toString() || ""}
          >
            <option value="">Select a customer...</option>
            {customers.map((customer: Customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.displayName}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Vendor"
            name="vendorId"
            defaultValue={editingOrder?.vendorId?.toString() || ""}
          >
            <option value="">Select a vendor...</option>
            {vendors.map((vendor: Vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.displayName}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Status"
            name="status"
            defaultValue={editingOrder?.status || "Pending"}
            required
          >
            <option value="Pending">Pending</option>
            <option value="In_Production">In Production</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </SelectField>

          <div>
            <label
              htmlFor="vendorPayPercentage"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              Vendor Pay Percentage
            </label>
            <div className="flex items-center space-x-2">
              <input
                id="vendorPayPercentage"
                type="number"
                name="vendorPayPercentage"
                value={vendorPayPercentage}
                onChange={(e) =>
                  setVendorPayPercentage(parseInt(e.target.value) || 0)
                }
                min="0"
                max="100"
                className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
              />
              <span className="text-gray-700 dark:text-gray-300">%</span>
              {editingOrder && editingOrder.lineItems && (
                <span className="text-sm text-gray-500 dark:text-gray-400 ml-4">
                  :{" "}
                  {formatCurrency(
                    (
                      (editingOrder.lineItems.reduce(
                        (sum, item) =>
                          sum +
                          item.quantity * parseFloat(item.unitPrice || "0"),
                        0
                      ) *
                        vendorPayPercentage) /
                      100
                    ).toString()
                  )}
                </span>
              )}
            </div>
          </div>

          <InputField
            label="Ship Date"
            name="shipDate"
            type="date"
            defaultValue={
              editingOrder?.shipDate
                ? new Date(editingOrder.shipDate).toISOString().split("T")[0]
                : ""
            }
          />

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!editingOrder && !!orderNumberError}
            >
              {editingOrder ? "Update" : "Create"} Order
            </Button>
          </div>
        </fetcher.Form>
      </Modal>
    </div>
  );
}
