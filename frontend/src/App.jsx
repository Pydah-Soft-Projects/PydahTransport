import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BusManagement from './pages/BusManagement';
import BusDetails from './pages/BusDetails';
import VehicleDetails from './pages/VehicleDetails';
import Fleet from './pages/Fleet';
import RouteManagement from './pages/RouteManagement';
import TransportRequests from './pages/TransportRequests';
import TransportDues from './pages/TransportDues';
import UserManagement from './pages/UserManagement';
import AdminRaiseRequest from './pages/AdminRaiseRequest';
import Renewals from './pages/Renewals';
import Concessions from './pages/Concessions';
import Inventory from './pages/Inventory';
import RaiseBill from './pages/RaiseBill';
import TransportVerify from './pages/TransportVerify';
import GpsTracking from './pages/GpsTracking';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/verify-transport/:id" element={<TransportVerify />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/buses" element={<ProtectedRoute><BusManagement /></ProtectedRoute>} />
          <Route path="/buses/:id" element={<ProtectedRoute><BusDetails /></ProtectedRoute>} />
          <Route path="/other-vehicles/:id" element={<ProtectedRoute><VehicleDetails /></ProtectedRoute>} />
          <Route path="/fleet" element={<ProtectedRoute><Fleet /></ProtectedRoute>} />
          <Route path="/routes" element={<ProtectedRoute><RouteManagement /></ProtectedRoute>} />
          <Route path="/gps-tracking" element={<ProtectedRoute><GpsTracking /></ProtectedRoute>} />
          <Route path="/transport-requests" element={<ProtectedRoute><TransportRequests /></ProtectedRoute>} />
          <Route path="/renewals" element={<ProtectedRoute><Renewals /></ProtectedRoute>} />
          <Route path="/transport-dues" element={<ProtectedRoute><TransportDues /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
          <Route path="/raise-request" element={<ProtectedRoute><AdminRaiseRequest /></ProtectedRoute>} />
          <Route path="/concessions" element={<ProtectedRoute><Concessions /></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
          <Route path="/inventory/raise-bill" element={<ProtectedRoute><RaiseBill /></ProtectedRoute>} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
