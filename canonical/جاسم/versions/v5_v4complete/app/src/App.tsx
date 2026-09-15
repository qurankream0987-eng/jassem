import { Routes, Route } from 'react-router'
import { WindowProvider } from './components/WindowProvider'
import Home from './pages/Home'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Agents from './pages/Agents'
import Merchants from './pages/Merchants'
import Products from './pages/Products'
import Orders from './pages/Orders'
import CVBuilder from './pages/CVBuilder'
import Jobs from './pages/Jobs'
import JobMatches from './pages/JobMatches'
import ConnectDashboard from './pages/ConnectDashboard'
import WidgetBuilder from './pages/WidgetBuilder'
import VisionHub from './pages/VisionHub'
import CrossBorderHub from './pages/CrossBorderHub'

export default function App() {
  return (
    <WindowProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/merchants" element={<Merchants />} />
        <Route path="/products" element={<Products />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/cv-builder" element={<CVBuilder />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/job-matches" element={<JobMatches />} />
        <Route path="/connect" element={<ConnectDashboard />} />
        <Route path="/widget" element={<WidgetBuilder />} />
        <Route path="/vision" element={<VisionHub />} />
        <Route path="/cross-border" element={<CrossBorderHub />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </WindowProvider>
  )
}
