import { Link } from "@remix-run/react"

export default function Navbar() {
  return (
    <div className="navbar">
      <h1>Subtract Admin Dashboard</h1>
      <div className="nav-links">
        <Link to="/">Dashboard</Link>
        <Link to="/orders">Orders</Link>
        <Link to="/customers">Customers</Link>
        <Link to="/vendors">Vendors</Link>
        <Link to="/quotes">Quoting</Link>
        <span className="user-auth">Admin User</span>
      </div>
    </div>
  )
}