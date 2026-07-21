import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './HomeIndexRail.css'

const chapters = [
  { id: 'top', index: '00', label: 'Intro', path: '/' },
  { id: 'live-index', index: '01', label: 'Index', path: '/index' },
  { id: 'system', index: '02', label: 'System', path: '/system' },
  { id: 'proof', index: '03', label: 'Proof', path: '/proof' },
  { id: 'economics', index: '04', label: 'Economics', path: '/economics' },
  { id: 'marketplace', index: '05', label: 'Agents', path: '/marketplace' },
]

export default function HomeIndexRail() {
  const location = useLocation()
  const navigate = useNavigate()
  const [active, setActive] = useState('top')

  useEffect(() => {
    const targets = chapters
      .map((chapter) => document.getElementById(chapter.id))
      .filter((target): target is HTMLElement => Boolean(target))

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible?.target.id) setActive(visible.target.id)
      },
      { rootMargin: '-32% 0px -56% 0px', threshold: [0, 0.08, 0.2, 0.45] },
    )

    targets.forEach((target) => observer.observe(target))
    return () => observer.disconnect()
  }, [])

  const openChapter = (chapter: (typeof chapters)[number]) => {
    if (location.pathname !== chapter.path) {
      navigate(chapter.path)
      return
    }
    document.getElementById(chapter.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav className="home-index" aria-label="Homepage chapter index">
      <span className="home-index__title mono">INDEX</span>
      {chapters.map((chapter) => (
        <button
          type="button"
          className={active === chapter.id ? 'home-index__item home-index__item--active' : 'home-index__item'}
          aria-current={active === chapter.id ? 'location' : undefined}
          onClick={() => openChapter(chapter)}
          key={chapter.id}
        >
          <span className="mono">{chapter.index}</span>
          <b>{chapter.label}</b>
          <i />
        </button>
      ))}
    </nav>
  )
}
