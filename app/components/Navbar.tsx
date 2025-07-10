import { Link } from "@remix-run/react";

export default function Navbar() {
  return (
    <div className="flex justify-between items-center bg-gray-800 text-white px-8 py-4">
      <h1 className="text-2xl font-semibold m-0">
        <Link to="/" className="text-white no-underline hover:opacity-80">
          Subtract Admin Dashboard
        </Link>
      </h1>
      <div className="flex items-center gap-5">
        <Link to="/ActionItems" className="text-white no-underline font-semibold transition-opacity hover:opacity-80">
          Action Items
        </Link>
        <Link to="/orders" className="text-white no-underline font-semibold transition-opacity hover:opacity-80">
          Orders
        </Link>
        <Link to="/customers" className="text-white no-underline font-semibold transition-opacity hover:opacity-80">
          Customers
        </Link>
        <Link to="/vendors" className="text-white no-underline font-semibold transition-opacity hover:opacity-80">
          Vendors
        </Link>
        <div className="flex items-center gap-3 px-3 py-2 rounded hover:bg-white/10 transition-colors cursor-pointer ml-5">
          <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-white/70 ml-1"></div>
          <span className="text-sm font-medium">Admin</span>
          <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-semibold text-sm overflow-hidden">
            A
            {/* Or use an image: */}
            {/* <img src="/profile-photo.jpg" alt="Admin" className="w-full h-full object-cover" /> */}
          </div>
        </div>
      </div>
    </div>
  );
}
