import { json, LoaderFunctionArgs, ActionFunctionArgs, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, Link } from "@remix-run/react";
import { getVendor, updateVendor, archiveVendor, getVendorOrders, getVendorStats } from "~/lib/vendors";
import { getNotes, createNote, updateNote, archiveNote } from "~/lib/notes";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import Navbar from "~/components/Navbar";
import Button from "~/components/shared/Button";
import Breadcrumbs from "~/components/Breadcrumbs";
import { Notes } from "~/components/shared/Notes";
import { InputField as FormField } from "~/components/shared/FormField";
import { useState } from "react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();
  
  const vendorId = params.vendorId;
  if (!vendorId) {
    throw new Response("Vendor ID is required", { status: 400 });
  }

  const vendor = await getVendor(parseInt(vendorId));
  if (!vendor) {
    throw new Response("Vendor not found", { status: 404 });
  }

  const [orders, stats, notes] = await Promise.all([
    getVendorOrders(vendor.id),
    getVendorStats(vendor.id),
    getNotes("vendor", vendor.id.toString())
  ]);

  return withAuthHeaders(
    json({ vendor, orders, stats, notes, user, userDetails, appConfig }),
    headers
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { headers } = await requireAuth(request);
  
  const vendorId = params.vendorId;
  if (!vendorId) {
    return json({ error: "Vendor ID is required" }, { status: 400 });
  }

  const vendor = await getVendor(parseInt(vendorId));
  if (!vendor) {
    return json({ error: "Vendor not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "updateVendor": {
        const displayName = formData.get("displayName") as string;
        const companyName = formData.get("companyName") as string;
        const contactName = formData.get("contactName") as string;
        const email = formData.get("email") as string;
        const phone = formData.get("phone") as string;
        const address = formData.get("address") as string;
        const discordId = formData.get("discordId") as string;

        const updated = await updateVendor(vendor.id, {
          displayName,
          companyName: companyName || null,
          contactName: contactName || null,
          email: email || null,
          phone: phone || null,
          address: address || null,
          discordId: discordId || null
        });

        return withAuthHeaders(json({ vendor: updated }), headers);
      }

      case "archiveVendor": {
        await archiveVendor(vendor.id);
        return redirect("/vendors");
      }

      case "getNotes": {
        const notes = await getNotes("vendor", vendor.id.toString());
        return withAuthHeaders(json({ notes }), headers);
      }

      case "createNote": {
        const content = formData.get("content") as string;
        const createdBy = formData.get("createdBy") as string;

        if (!content || !createdBy) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const note = await createNote({
          entityType: "vendor",
          entityId: vendor.id.toString(),
          content,
          createdBy,
        });

        return withAuthHeaders(json({ note }), headers);
      }

      case "updateNote": {
        const noteId = formData.get("noteId") as string;
        const content = formData.get("content") as string;

        if (!noteId || !content) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const note = await updateNote(noteId, content);
        return withAuthHeaders(json({ note }), headers);
      }

      case "deleteNote": {
        const noteId = formData.get("noteId") as string;

        if (!noteId) {
          return json({ error: "Missing note ID" }, { status: 400 });
        }

        const note = await archiveNote(noteId);
        return withAuthHeaders(json({ note }), headers);
      }

      default:
        return json({ error: "Invalid intent" }, { status: 400 });
    }
  } catch (error) {
    console.error("Action error:", error);
    return json({ error: "Failed to process request" }, { status: 500 });
  }
}

export default function VendorDetails() {
  const { vendor, orders, stats, notes, user, userDetails, appConfig } = useLoaderData<typeof loader>();
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const updateFetcher = useFetcher();

  const handleSaveInfo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("intent", "updateVendor");
    updateFetcher.submit(formData, { method: "post" });
    setIsEditingInfo(false);
  };

  const handleSaveContact = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("intent", "updateVendor");
    updateFetcher.submit(formData, { method: "post" });
    setIsEditingContact(false);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "--";
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'In_Production':
        return 'In Production';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar 
        userName={userDetails?.name || user.email} 
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
        version={appConfig.version}
        isStaging={appConfig.isStaging}
      />
      <div className="max-w-[1920px] mx-auto">
        <div className="flex justify-between items-center px-10 py-2.5">
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/" },
            { label: "Vendors", href: "/vendors" },
            { label: vendor.displayName }
          ]} />
          <div className="flex flex-wrap gap-3">
            <Button 
              variant="danger"
              onClick={() => {
                if (confirm("Are you sure you want to archive this vendor?")) {
                  const formData = new FormData();
                  formData.append("intent", "archiveVendor");
                  updateFetcher.submit(formData, { method: "post" });
                }
              }}
            >
              Archive
            </Button>
          </div>
        </div>
        
        <div className="px-4 sm:px-6 lg:px-10 py-6 space-y-6">
          {/* Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Total Orders</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{stats.totalOrders}</p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Active Orders</h3>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{stats.activeOrders}</p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Total Earnings</h3>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">{formatCurrency(stats.totalEarnings)}</p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Avg Lead Time</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {stats.averageLeadTime ? `${stats.averageLeadTime} days` : "--"}
              </p>
            </div>
          </div>

          {/* Information Sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Vendor Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Vendor Information</h3>
                {!isEditingInfo && (
                  <Button variant="secondary" size="sm" onClick={() => setIsEditingInfo(true)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="p-6">
                {isEditingInfo ? (
                  <updateFetcher.Form onSubmit={handleSaveInfo}>
                    <div className="space-y-4">
                      <FormField
                        label="Display Name"
                        name="displayName"
                        defaultValue={vendor.displayName}
                        required
                      />
                      <FormField
                        label="Company Name"
                        name="companyName"
                        defaultValue={vendor.companyName || ""}
                      />
                      <FormField
                        label="Discord ID"
                        name="discordId"
                        defaultValue={vendor.discordId || ""}
                      />
                      <input type="hidden" name="contactName" value={vendor.contactName || ""} />
                      <input type="hidden" name="email" value={vendor.email || ""} />
                      <input type="hidden" name="phone" value={vendor.phone || ""} />
                      <input type="hidden" name="address" value={vendor.address || ""} />
                      <div className="flex gap-2">
                        <Button type="submit" variant="primary" size="sm">Save</Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditingInfo(false)}>Cancel</Button>
                      </div>
                    </div>
                  </updateFetcher.Form>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Display Name</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.displayName}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Company Name</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.companyName || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Vendor ID</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">VEN-{vendor.id.toString().padStart(5, '0')}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Status</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.isArchived ? 'Inactive' : 'Active'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Discord ID</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.discordId || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Created Date</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{formatDate(vendor.createdAt)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Contact Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Contact Information</h3>
                {!isEditingContact && (
                  <Button variant="secondary" size="sm" onClick={() => setIsEditingContact(true)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="p-6">
                {isEditingContact ? (
                  <updateFetcher.Form onSubmit={handleSaveContact}>
                    <div className="space-y-4">
                      <input type="hidden" name="displayName" value={vendor.displayName} />
                      <input type="hidden" name="companyName" value={vendor.companyName || ""} />
                      <input type="hidden" name="discordId" value={vendor.discordId || ""} />
                      <FormField
                        label="Primary Contact Name"
                        name="contactName"
                        defaultValue={vendor.contactName || ""}
                      />
                      <FormField
                        label="Email"
                        name="email"
                        type="email"
                        defaultValue={vendor.email || ""}
                      />
                      <FormField
                        label="Phone"
                        name="phone"
                        type="tel"
                        defaultValue={vendor.phone || ""}
                      />
                      <FormField
                        label="Address"
                        name="address"
                        defaultValue={vendor.address || ""}
                      />
                      <div className="flex gap-2">
                        <Button type="submit" variant="primary" size="sm">Save</Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditingContact(false)}>Cancel</Button>
                      </div>
                    </div>
                  </updateFetcher.Form>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Primary Contact Name</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.contactName || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Email</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.email || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Phone</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.phone || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Address</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.address || "--"}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Order History */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Order History</h3>
            </div>
            <div className="p-6">
              {orders.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Order Number
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Customer
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Vendor Pay
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {orders.map((order: any) => (
                        <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                            {order.orderNumber}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                            {order.customer?.displayName || "--"}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {formatDate(order.createdAt)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusClasses(order.status)}`}>
                              {getStatusDisplay(order.status)}
                            </span>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                            {formatCurrency(parseFloat(order.vendorPay || '0'))}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm">
                            <Link
                              to={`/orders/${order.orderNumber}`}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No orders found for this vendor.
                </p>
              )}
            </div>
          </div>

          {/* Notes Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Notes</h3>
            </div>
            <div className="p-6">
              <Notes 
                entityType="vendor" 
                entityId={vendor.id.toString()} 
                initialNotes={notes}
                currentUserId={user.id || user.email}
                currentUserName={userDetails?.name || user.email}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}