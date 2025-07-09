import Navbar from "~/components/Navbar";
import SearchHeader from "~/components/SearchHeader";

export default function Quotes() {
  return (
    <div>
      <Navbar />
      <SearchHeader breadcrumbs="Dashboard / Quoting" />

      <div className="section">
        <h2>Quoting System</h2>
        <div
          style={{
            backgroundColor: "white",
            padding: "40px",
            borderRadius: "10px",
            border: "1px solid gray",
            textAlign: "center",
            color: "#666",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Coming Soon</h3>
          <p>The quoting system is under development</p>
          <p>Please use the Orders section for now to manage your workflow.</p>
        </div>
      </div>
    </div>
  );
}
