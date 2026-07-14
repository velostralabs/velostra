import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, Menu, X } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import BrandMark from './BrandMark'
import WalletButton from './WalletButton'
import './Nav.css'

const navItems = [
  { to: '/index', label: 'Index' },
  { to: '/system', label: 'System' },
  { to: '/proof', label: 'Proof' },
  { to: '/economics', label: 'Economics' },
  { to: '/marketplace', label: 'Agents' },
  { to: '/docs', label: 'Protocol' },
  { to: '/builder', label: 'Builders' },
]

export default function Nav() {
  const location = useLocation()
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => setMenuOpen(false), [location.pathname, location.hash])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  return (
    <header className="nav-wrap">
      <nav className="nav" aria-label="Primary navigation">
        <Link to="/" className="nav__brand" aria-label="Velostra home">
          <BrandMark className="nav__mark" />
          <span className="nav__word">velostra</span>
        </Link>

        <div className="nav__links">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => isActive ? 'nav__link--active' : undefined}
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="nav__actions">
          <Link to="/dashboard" className="nav__launch">
            Open console <ArrowUpRight size={14} strokeWidth={1.8} />
          </Link>
          <WalletButton />
          <button
            ref={menuButtonRef}
            type="button"
            className="nav__menu-toggle"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            id="mobile-navigation"
            className="nav__mobile nav__mobile--open"
            aria-label="Mobile navigation"
            initial={{ opacity: 0, y: -10, clipPath: 'inset(0 0 100% 0 round 10px)' }}
            animate={{ opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0 round 10px)' }}
            exit={{ opacity: 0, y: -7, clipPath: 'inset(0 0 100% 0 round 10px)' }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
          >
            {navItems.map((item, index) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => isActive ? 'nav__mobile-link--active' : undefined}
              >
                <span className="mono">0{index + 1}</span>
                {item.label}
              </NavLink>
            ))}
            <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'nav__mobile-link--active' : undefined}>
              <span className="mono">08</span>
              Execution console
            </NavLink>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}