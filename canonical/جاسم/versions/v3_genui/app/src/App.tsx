import { Routes, Route } from 'react-router'
import { WindowProvider } from './components/WindowProvider'
import Home from './pages/Home'
import Login from './pages/Login'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <WindowProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </WindowProvider>
  )
}
