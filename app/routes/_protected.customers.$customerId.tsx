import { json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { useLoaderData, Link, useNavigate, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { getCustomer, updateCustomer, archiveCustomer } from "~/lib/customers";
import type { CustomerInput } from "~/lib/customers";
import { getOrdersWithRelations } from "~/lib/orders";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import Navbar from "~/components/Navbar";
import SearchHeader from "~/components/SearchHeader";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";
import { InputField } from "~/components/shared/FormField";
import { styles, tableStyles, statusStyles } from "~/utils/tw-styles";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  
  const customerId = params.customerId;
  if (!customerId) {
    throw new Response("Customer ID is required", { status: 400 });
  }

  const customer = await getCustomer(parseInt(customerId));
  if (!customer) {
    throw new Response("Customer not found", { status: 404 });
  }

  // Get all orders and filter for this customer
  const allOrders = await getOrdersWithRelations();
  const customerOrders = allOrders.filter(order => order.customerId === customer.id);

  return withAuthHeaders(
    json({ customer, customerOrders, user, userDetails }),
    headers
  );
}

export async function action({ request, params }: LoaderFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const customerId = params.customerId;

  if (!customerId) {
    throw new Response("Customer ID is required", { status: 400 });
  }

  try {
    switch (intent) {
      case "update": {
        const customerData: Partial<CustomerInput> = {
          displayName: formData.get("displayName") as string,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
        }
        await updateCustomer(parseInt(customerId), customerData);
        return redirect(`/customers/${customerId}`);
      }
      case "archive": {
        await archiveCustomer(parseInt(customerId));
        return redirect("/customers");
      }
      default:
        return json({ error: "Invalid intent" }, { status: 400 });
    }
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 });
  }
}

export default function CustomerDetails() {
  const { customer, customerOrders, user, userDetails } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const handleArchive = () => {
    if (confirm(`Are you sure you want to archive ${customer.displayName}? This will hide them from the list.`)) {
      fetcher.submit(
        { intent: "archive" },
        { method: "post" }
      );
    }
  };

  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return "--";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount));
  };

  const getStatusStyle = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return statusStyles.pending;
      case 'in_production':
        return statusStyles.inProduction;
      case 'completed':
        return statusStyles.completed;
      case 'cancelled':
        return statusStyles.cancelled;
      case 'archived':
        return statusStyles.archived;
      default:
        return '';
    }
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'In_Production':
        return 'In Production';
      default:
        return status;
    }
  };

  return (
    <div>
      <Navbar 
        userName={userDetails?.name || user.email} 
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
      />
      <div className="max-w-[1920px] mx-auto">
        <SearchHeader breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Customers", href: "/customers" },
          { label: customer.displayName }
        ]} />
        
        <div className="px-10 py-8">
          {/* Customer Info Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md transition-colors duration-150">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {customer.displayName}
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Customer ID: {customer.id}
                </p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setIsEditModalOpen(true)}
                  className="p-2 text-white bg-blue-600 rounded hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors duration-150"
                  title="Edit Customer"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
                  </svg>
                </button>
                <button
                  onClick={handleArchive}
                  className="p-2 text-white bg-red-600 rounded hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition-colors duration-150"
                  title="Archive Customer"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15h9.286zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1zM.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8H.8z"/>
                  </svg>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Email</h3>
                <p className="mt-1 text-gray-900 dark:text-gray-100">
                  {customer.email || "No email provided"}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Phone</h3>
                <p className="mt-1 text-gray-900 dark:text-gray-100">
                  {customer.phone || "No phone provided"}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Customer Since</h3>
                <p className="mt-1 text-gray-900 dark:text-gray-100">
                  {formatDate(customer.createdAt)}
                </p>
              </div>
            </div>
          </div>

          {/* Orders Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-md transition-colors duration-150 mt-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Orders ({customerOrders.length})
            </h2>
            
            {customerOrders.length > 0 ? (
              <table className={tableStyles.container}>
                <thead className={tableStyles.header}>
                  <tr>
                    <th className={tableStyles.headerCell}>Order #</th>
                    <th className={tableStyles.headerCell}>Vendor</th>
                    <th className={tableStyles.headerCell}>Status</th>
                    <th className={tableStyles.headerCell}>Total Price</th>
                    <th className={tableStyles.headerCell}>Ship Date</th>
                    <th className={tableStyles.headerCell}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {customerOrders.map((order: any) => (
                    <tr key={order.id} className={`${tableStyles.row} cursor-pointer hover:bg-gray-50`}>
                      <td className={tableStyles.cell}>
                        <Link to={`/orders/${order.orderNumber}`} className="block text-blue-600 hover:text-blue-800">
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td className={tableStyles.cell}>
                        <Link to={`/orders/${order.orderNumber}`} className="block">
                          {order.vendor?.displayName || '--'}
                        </Link>
                      </td>
                      <td className={`${tableStyles.cell} ${statusStyles.base} ${getStatusStyle(order.status)}`}>
                        <Link to={`/orders/${order.orderNumber}`} className="block">
                          {getStatusDisplay(order.status)}
                        </Link>
                      </td>
                      <td className={tableStyles.cell}>
                        <Link to={`/orders/${order.orderNumber}`} className="block">
                          {formatCurrency(order.totalPrice)}
                        </Link>
                      </td>
                      <td className={tableStyles.cell}>
                        <Link to={`/orders/${order.orderNumber}`} className="block">
                          {order.shipDate ? formatDate(order.shipDate) : '--'}
                        </Link>
                      </td>
                      <td className={tableStyles.cell}>
                        <Link to={`/orders/${order.orderNumber}`} className="block">
                          {formatDate(order.createdAt)}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-gray-600 dark:text-gray-400 py-8 text-center">
                No orders found for this customer.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Edit Customer"
      >
        <fetcher.Form method="post" onSubmit={() => setIsEditModalOpen(false)}>
          <input type="hidden" name="intent" value="update" />
          
          <InputField
            label="Name"
            name="displayName"
            defaultValue={customer.displayName}
            required
          />
          
          <InputField
            label="Email"
            name="email"
            type="email"
            defaultValue={customer.email || ''}
          />
          
          <InputField
            label="Phone"
            name="phone"
            type="tel"
            defaultValue={customer.phone || ''}
          />

          <div className="flex gap-3 justify-end mt-6">
            <Button type="button" variant="secondary" onClick={() => setIsEditModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">
              Update Customer
            </Button>
          </div>
        </fetcher.Form>
      </Modal>
    </div>
  );
}