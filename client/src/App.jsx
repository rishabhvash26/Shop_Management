import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import Inventory from './pages/Inventory.jsx';
import SalesOrders from './pages/SalesOrders.jsx';
import PurchaseOrders from './pages/PurchaseOrders.jsx';
import Transactions from './pages/Transactions.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <h1>Shop Management</h1>
        <nav>
          <NavLink to="/inventory" className={({ isActive }) => (isActive ? 'active' : '')}>
            Inventory
          </NavLink>
          <NavLink to="/sales-orders" className={({ isActive }) => (isActive ? 'active' : '')}>
            Sales Orders
          </NavLink>
          <NavLink to="/purchase-orders" className={({ isActive }) => (isActive ? 'active' : '')}>
            Purchase Orders
          </NavLink>
          <NavLink to="/transactions" className={({ isActive }) => (isActive ? 'active' : '')}>
            Transactions
          </NavLink>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/inventory" replace />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/sales-orders" element={<SalesOrders />} />
          <Route path="/purchase-orders" element={<PurchaseOrders />} />
          <Route path="/transactions" element={<Transactions />} />
        </Routes>
      </main>
    </div>
  );
}
