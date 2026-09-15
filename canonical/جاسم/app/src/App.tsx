import { WindowProvider } from '@/components/WindowProvider'
import Home from '@/pages/Home'
import { Toaster } from 'sonner'

function App() {
  return (
    <WindowProvider>
      <div className="h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden">
        <Home />
        <Toaster position="top-center" theme="dark" />
      </div>
    </WindowProvider>
  )
}

export default App
