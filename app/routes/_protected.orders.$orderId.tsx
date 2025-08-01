import { json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getOrderByNumber } from "~/lib/orders";
import { getCustomer } from "~/lib/customers";
import { getVendor } from "~/lib/vendors";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import Navbar from "~/components/Navbar";
import Button from "~/components/shared/Button";
import Breadcrumbs from "~/components/Breadcrumbs";
import { useState } from "react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  
  const orderNumber = params.orderId; // Note: param name stays the same but now represents orderNumber
  if (!orderNumber) {
    throw new Response("Order number is required", { status: 400 });
  }

  const order = await getOrderByNumber(orderNumber);
  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  // Fetch customer and vendor details
  const customer = order.customerId ? await getCustomer(order.customerId) : null;
  const vendor = order.vendorId ? await getVendor(order.vendorId) : null;

  return withAuthHeaders(
    json({ order, customer, vendor, user, userDetails }),
    headers
  );
}

export default function OrderDetails() {
  const { order, customer, vendor, user, userDetails } = useLoaderData<typeof loader>();
  const [showNotice, setShowNotice] = useState(true);

  // Calculate days until ship date
  const shipDate = order.shipDate ? new Date(order.shipDate) : null;
  const today = new Date();
  const daysUntilShip = shipDate ? Math.ceil((shipDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;

  // Determine priority based on days until ship
  const getPriority = () => {
    if (!daysUntilShip) return "Normal";
    if (daysUntilShip <= 3) return "Critical";
    if (daysUntilShip <= 7) return "High";
    return "Normal";
  };

  const priority = getPriority();

  // Format currency
  const formatCurrency = (amount: string | null) => {
    if (!amount) return "$0.00";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount));
  };

  // Format date
  const formatDate = (date: Date | string | null) => {
    if (!date) return "--";
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
  };

  // Get status display
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'In_Production':
        return 'In Production';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  // Get status color classes
  const getStatusClasses = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
      case 'in_production':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
      case 'completed':
        return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
      case 'cancelled':
        return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  // Get priority color classes
  const getPriorityClasses = (priority: string) => {
    switch (priority) {
      case 'Critical':
        return 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100';
      case 'High':
        return 'bg-orange-200 text-orange-900 dark:bg-orange-800 dark:text-orange-100';
      default:
        return 'bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100';
    }
  };

  // Mock progress (in real app, this would come from order data)
  const progress = 65;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar 
        userName={userDetails?.name || user.email} 
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
      />
      <div className="max-w-[1920px] mx-auto">
        {/* Custom breadcrumb bar with buttons */}
        <div className="flex justify-between items-center px-10 py-2.5">
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/" },
            { label: "Orders", href: "/orders" },
            { label: order.orderNumber }
          ]} />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" className="bg-green-600 hover:bg-green-700">
              Update Status
            </Button>
            <Button variant="primary" className="bg-blue-600 hover:bg-blue-700">
              Edit Order
            </Button>
          </div>
        </div>
        
        <div className="px-4 sm:px-6 lg:px-10 py-6 space-y-6">

          {/* Notice Bar */}
          {showNotice && daysUntilShip && daysUntilShip <= 7 && (
            <div className="relative bg-yellow-100 dark:bg-yellow-900/50 border-2 border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
              <button
                onClick={() => setShowNotice(false)}
                className="absolute top-2 right-2 text-yellow-600 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <p className="font-semibold text-yellow-800 dark:text-yellow-200">
                Attention: This order is approaching its due date ({daysUntilShip} days remaining)
              </p>
            </div>
          )}

          {/* Status Cards - Always at top */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {/* Order Status Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Order Status</h3>
              <div className={`px-4 py-3 rounded-full text-center font-semibold ${getStatusClasses(order.status)}`}>
                {getStatusDisplay(order.status)}
              </div>
            </div>

            {/* Priority Level Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Priority Level</h3>
              <div className={`px-4 py-3 rounded-full text-center font-semibold ${getPriorityClasses(priority)}`}>
                {priority} Priority
              </div>
            </div>

            {/* Order Value Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Order Value</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {formatCurrency(order.totalPrice)}
              </p>
            </div>

            {/* Progress Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Progress</h3>
              <div className="relative w-full h-8 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="absolute top-0 left-0 h-full bg-green-500 dark:bg-green-600 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
                  {progress}%
                </span>
              </div>
            </div>
          </div>

          {/* Information Sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Order Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Order Information</h3>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Order Number</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{order.orderNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Order Date</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{formatDate(order.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Ship Date</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{formatDate(order.shipDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Lead Time</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {order.leadTime ? `${order.leadTime} Business Days` : "--"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Customer Information</h3>
              </div>
              <div className="p-6">
                {customer ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Company</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.displayName}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Customer ID</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">CUST-{customer.id.toString().padStart(5, '0')}</p>
                    </div>
                    {customer.email && (
                      <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4">
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Primary Contact</p>
                        <p className="text-gray-900 dark:text-gray-100">{customer.email}</p>
                        {customer.phone && <p className="text-gray-900 dark:text-gray-100">{customer.phone}</p>}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400">No customer information available</p>
                )}
              </div>
            </div>
          </div>

          {/* Notes Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Notes</h3>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                Add Note
              </Button>
            </div>
            <div className="p-6">
              {order.notes ? (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border-2 border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <p className="text-gray-700 dark:text-gray-300">{order.notes}</p>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No notes available for this order
                </p>
              )}
            </div>
          </div>

          {/* Vendor Information */}
          {vendor && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Vendor Information</h3>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Vendor</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.displayName}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Company</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.companyName || "--"}</p>
                  </div>
                  {vendor.contactName && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Contact</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.contactName}</p>
                    </div>
                  )}
                  {vendor.email && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Email</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.email}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}