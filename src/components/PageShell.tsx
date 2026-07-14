import type { ReactNode } from 'react'
import TickerTape from './TickerTape'
import Nav from './Nav'
import Footer from './Footer'
import './PageShell.css'

export default function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="app app--console">
      <TickerTape />
      <Nav />
      <main className="page" id="main-content" tabIndex={-1}>{children}</main>
      <Footer compact />
    </div>
  )
}
