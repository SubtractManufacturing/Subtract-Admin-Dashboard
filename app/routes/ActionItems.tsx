import Navbar from "~/components/Navbar";
import SearchHeader from "~/components/SearchHeader";

export default function Quotes() {
  return (
    <div>
      <Navbar />
      <SearchHeader breadcrumbs="Dashboard / Action Items" />

      <div className="section">
        <h2>Items that require Input</h2>
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
          <p>This system is under development</p>
          <p>Please use the Orders section for now to manage orders.</p>
        </div>
      </div>
    </div>
  );
}
