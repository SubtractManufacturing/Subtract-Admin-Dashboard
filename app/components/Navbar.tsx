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
        <Link to="/ActionItems">Action Items</Link>
        <Link to="/orders">Orders</Link>
        <Link to="/customers">Customers</Link>
        <Link to="/vendors">Vendors</Link>
        <div className="auth-widget">
          <div className="dropdown-arrow"></div>
          <span className="username">Admin</span>
          <div className="profile-photo">
            A{/* Or use an image: */}
            {/* <img src="/profile-photo.jpg" alt="Admin" /> */}
          </div>
        </div>
      </div>
    </div>
  );
}
