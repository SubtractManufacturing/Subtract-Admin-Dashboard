import { Link } from "@remix-run/react";

export default function Navbar() {
  return (
    <div className="navbar">
      <h1>
        <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
          Subtract Admin Dashboard
        </Link>
      </h1>
      <div className="nav-links">
        <Link to="/orders">Orders</Link>
        <Link to="/customers">Customers</Link>
        <Link to="/vendors">Vendors</Link>
        <Link to="/ActionItems">Action Items</Link>
        <span className="user-auth">Admin User</span>
      </div>
    </div>
  );
}
