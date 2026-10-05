import { EXTERNAL_CONNECTIONS } from "../../../domains/finance/connections.ts";
import PlandayConnection from "./PlandayConnection";

/** Sage, Xero, Payday and Hotelkit. None of them are signed in. */
export default function ExternalConnections() {
  return (
    <section className="house-panel connections" id="connections" aria-label="Connections">
      <PlandayConnection />
      <div className="k">Connections</div>
      <h2>Sage, Xero, Payday and Hotelkit</h2>
      <p>Each product is not connected. A signed-in account is still needed before anything can sync. Nothing on this page is a balance, an invoice, a payslip or a hotel task from those products.</p>
      <div className="connect-grid">
        {EXTERNAL_CONNECTIONS.map(connection => (
          <article key={connection.code} className="connect-card">
            <h3>{connection.name}</h3>
            <p className="m">{connection.product}</p>
            <p className="connect-status">Not connected</p>
            <p>{connection.detail}</p>
            {connection.site && (
              <a href={connection.site} target="_blank" rel="noreferrer">Product site</a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
