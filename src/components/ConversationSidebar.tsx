import { useEffect, useRef, useState } from 'react'
import { Download, MoreHorizontal, PanelLeftClose, Pencil, Pin, Search, Settings2, SquarePen, Trash2, X } from 'lucide-react'
import type { ChatSession } from '../App'
import { interfaceLocale, tr } from '../utils/i18n'

export function ConversationSidebar({ open, onClose, chats, currentId, busy, onNew, onOpen, onSettings, onRename, onPin, onDelete }: {
  open: boolean; onClose: () => void; chats: ChatSession[]; currentId: string | null; busy: boolean
  onNew: () => void; onOpen: (chat: ChatSession) => void; onSettings: () => void
  onRename: (id: string, title: string) => void; onPin: (id: string) => void; onDelete: (id: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [renaming, setRenaming] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open) { dialog.current?.close(); setMenuFor(null); setRenaming(null); setDeleting(null) }
  }, [open])
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node) && !(event.target as Element).closest('[data-conversation-menu]')) setMenuFor(null) }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])
  const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
  const filtered = [...chats].filter(chat => normalized(chat.title).includes(normalized(query))).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.timestamp - a.timestamp)
  const groups: Record<string, ChatSession[]> = {}
  const today = new Date().toDateString(), yesterday = new Date(Date.now() - 86400000).toDateString()
  for (const chat of filtered) {
    const day = new Date(chat.timestamp).toDateString()
    const group = chat.pinned ? 'Épinglées' : day === today ? 'Aujourd’hui' : day === yesterday ? 'Hier' : 'Plus anciennes'
    ;(groups[group] ??= []).push(chat)
  }
  const selected = chats.find(chat => chat.id === menuFor)
  const finishRename = () => { if (renaming && title.trim()) onRename(renaming, title.trim()); setRenaming(null) }
  const exportChat = (chat: ChatSession) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...chat, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `${chat.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 80) || 'conversation'}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000); setMenuFor(null)
  }
  return <dialog ref={dialog} className="conversation-sidebar" aria-label={tr('Conversations')}
    onClose={onClose} onCancel={event => { if (menuFor || deleting) { event.preventDefault(); setMenuFor(null); setDeleting(null) } else onClose() }}
    onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX > r.right) onClose() } }}>
    <div className="sidebar-top"><span className="sidebar-brand">local<span>ai</span></span><button type="button" className="header-icon" onClick={onClose} aria-label={tr('Fermer les conversations')}><PanelLeftClose size={18} /></button></div>
    <button type="button" className="sidebar-settings" disabled={busy} onClick={() => { onClose(); onSettings() }}><Settings2 size={17} />{tr('Paramètres')}</button>
    <div className="sidebar-section-heading"><span>{tr('Conversations')}</span><button type="button" disabled={busy} className="header-icon" onClick={onNew} aria-label={tr('Nouvelle conversation')}><SquarePen size={17} /></button></div>
    <label className="sidebar-search"><Search size={14} /><input value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder={tr('Rechercher')} aria-label={tr('Rechercher une conversation')} />{query && <button type="button" onClick={() => setQuery('')} aria-label={tr('Fermer')}><X size={12} /></button>}</label>
    <nav className="sidebar-chats" aria-label={tr('Conversations')} onScroll={() => setMenuFor(null)}>
      {!filtered.length && <div className="sidebar-empty">{tr(chats.length ? 'Aucune conversation trouvée.' : 'Vos conversations apparaîtront ici.')}</div>}
      {Object.entries(groups).map(([label, list]) => <section className="sidebar-chat-group" key={label}><h3>{tr(label)}</h3>
        {list.map(chat => <div key={chat.id} className={`sidebar-chat ${currentId === chat.id ? 'is-active' : ''}`}>
          {renaming === chat.id ? <input autoFocus className="sidebar-rename" aria-label={tr('Titre de la conversation')} value={title} maxLength={160} onFocus={event => event.currentTarget.select()} onChange={event => setTitle(event.currentTarget.value)} onBlur={finishRename} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); finishRename() } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(null) } }} /> : <button type="button" className="sidebar-chat-open" disabled={busy} onClick={() => onOpen(chat)} aria-current={currentId === chat.id ? 'page' : undefined} title={chat.title}>{chat.pinned && <Pin size={12} />}<span>{chat.title}</span></button>}
          <button type="button" data-conversation-menu className="sidebar-more" disabled={busy} aria-label={`${tr('Options de conversation')} : ${chat.title}`} aria-haspopup="menu" aria-expanded={menuFor === chat.id}
            onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setPosition({ left: Math.max(12, Math.min(rect.right - 192, window.innerWidth - 204)), top: Math.min(rect.bottom + 5, window.innerHeight - 205) }); setMenuFor(menuFor === chat.id ? null : chat.id) }}><MoreHorizontal size={17} /></button>
        </div>)}
      </section>)}
    </nav>
    <footer className="sidebar-footer">{tr('Conservées sur cet appareil')}<span>{new Intl.NumberFormat(interfaceLocale()).format(chats.length)}</span></footer>
    {selected && <div ref={menu} className="conversation-menu" role="menu" style={position} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')); const i = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(i + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus() }
    }}>
      <button type="button" role="menuitem" autoFocus onClick={() => { setRenaming(selected.id); setTitle(selected.title); setMenuFor(null) }}><Pencil size={15} />{tr('Renommer')}</button>
      <button type="button" role="menuitem" onClick={() => exportChat(selected)}><Download size={15} />{tr('Exporter')}</button>
      <button type="button" role="menuitem" onClick={() => { onPin(selected.id); setMenuFor(null) }}><Pin size={15} />{tr(selected.pinned ? 'Désépingler' : 'Épingler')}</button>
      <div className="menu-divider" /><button type="button" role="menuitem" className="danger-text" onClick={() => { setDeleting(selected.id); setMenuFor(null) }}><Trash2 size={15} />{tr('Supprimer')}</button>
    </div>}
    {deleting && <div className="sidebar-delete-confirm" role="alertdialog" aria-label={tr('Supprimer la conversation ?')}><h3>{tr('Supprimer la conversation ?')}</h3><p>{tr('Cette conversation sera supprimée de cet appareil.')}</p><div><button type="button" onClick={() => setDeleting(null)}>{tr('Annuler')}</button><button type="button" className="danger-text" onClick={() => { onDelete(deleting); setDeleting(null) }}>{tr('Supprimer')}</button></div></div>}
  </dialog>
}
