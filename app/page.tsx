'use client'

import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { User } from '@supabase/supabase-js'

// Preset users in alphabetical order
const USERS = [
  'Chas',
  'Clay',
  'Craig',
  'Daniel',
  'John',
  'Matt',
  'Nick',
  'Ryan',
  'Sean',
  'Ted',
  'Trey',
  'Will',
  'Zac',
]

// Email to display name mapping
const EMAIL_TO_NAME: Record<string, string> = {
  'chas.plaisance@gmail.com': 'Chas',
  'williams.clay2009@gmail.com': 'Clay',
  'craigbrown.gatech@gmail.com': 'Craig',
  'dadomanico@gmail.com': 'Daniel',
  'johnandersonmurray@hotmail.com': 'John',
  'mattmills49@gmail.com': 'Matt',
  'nkeith88@gmail.com': 'Nick',
  'rjkerns11@gmail.com': 'Ryan',
  'seanwalkerarnold@gmail.com': 'Sean',
  'tturner787@gmail.com': 'Ted',
  'treyzepernick@gmail.com': 'Trey',
  'wengland09@gmail.com': 'Will',
  'zkannan3@gmail.com': 'Zac',
}

// Whitelisted emails for authentication
const ALLOWED_EMAILS = [
  ...Object.keys(EMAIL_TO_NAME),
  'creeves24@gmail.com',
]

// Wager data model (matches Supabase schema)
interface Wager {
  id: string
  from_user: string
  to_user: string
  amount: number
  odds: number // Positive odds only (e.g., 300 for +300)
  description: string
  status: 'open' | 'resolved'
  result?: 'from' | 'to' | 'push' | null
  created_by?: string | null
  created_at?: string
  updated_at?: string
}

// Activity item for the Recent Activity feed
interface ActivityItem {
  id: string
  type: 'created' | 'resolved'
  user: string
  opponent: string
  result?: 'win' | 'loss' | 'push'
  timestamp: string
  description: string
}

// Heatmap threshold type
interface HeatmapThresholds {
  low: number
  medium: number
}

// Format relative time (e.g., "5m ago", "2h ago", "3d ago")
function formatRelativeTime(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return then.toLocaleDateString()
}

// Derive activity items from wagers (most recent first, limit 8)
function deriveActivityItems(wagers: Wager[]): ActivityItem[] {
  const activities: ActivityItem[] = []

  for (const wager of wagers) {
    // Add "created" activity for all wagers
    if (wager.created_at) {
      activities.push({
        id: `${wager.id}-created`,
        type: 'created',
        user: wager.from_user,
        opponent: wager.to_user,
        timestamp: wager.created_at,
        description: wager.description,
      })
    }

    // Add "resolved" activity for resolved wagers
    if (wager.status === 'resolved' && wager.result) {
      const resultText = wager.result === 'push' ? 'push' : (wager.result === 'from' ? 'win' : 'loss')
      activities.push({
        id: `${wager.id}-resolved`,
        type: 'resolved',
        user: wager.from_user,
        opponent: wager.to_user,
        result: resultText as 'win' | 'loss' | 'push',
        timestamp: wager.updated_at || wager.created_at || new Date().toISOString(),
        description: wager.description,
      })
    }
  }

  // Sort by timestamp descending and limit to 8 items
  return activities
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8)
}

// Get all wagers between two users (both directions) - only open wagers for grid
function getWagersBetweenUsers(wagers: Wager[], user1: string, user2: string, openOnly: boolean = false): Wager[] {
  return wagers.filter(
    (wager) =>
      ((wager.from_user === user1 && wager.to_user === user2) ||
      (wager.from_user === user2 && wager.to_user === user1)) &&
      (!openOnly || wager.status === 'open')
  )
}

// Get total dollar amount between two users (open wagers only)
function getCellAmount(wagers: Wager[], user1: string, user2: string): number {
  const userWagers = getWagersBetweenUsers(wagers, user1, user2, true)
  return userWagers.reduce((sum, wager) => sum + wager.amount, 0)
}

// Get heatmap class based on cell amount and dynamic thresholds
function getCellHeatmapClass(amount: number, thresholds: HeatmapThresholds): string {
  if (amount === 0) return ''
  if (amount <= thresholds.low) return 'heat-low'
  if (amount <= thresholds.medium) return 'heat-medium'
  return 'heat-high'
}

// Calculate total exposure for a user (open wagers they placed)
// Exposure = what they could lose = amount * (odds/100)
function calculateUserExposure(wagers: Wager[], user: string): number {
  return wagers
    .filter((wager) => wager.from_user === user && wager.status === 'open')
    .reduce((total, wager) => total + wager.amount * (wager.odds / 100), 0)
}

// Get cell data for wagers from one user to another (directional, open wagers only)
function getCellData(wagers: Wager[], fromUser: string, toUser: string): { amount: number; count: number } {
  const userWagers = wagers.filter(
    w => w.from_user === fromUser && w.to_user === toUser && w.status === 'open'
  )
  const totalAmount = userWagers.reduce((sum, wager) => sum + wager.amount, 0)
  return { amount: totalAmount, count: userWagers.length }
}

// Format odds for display (positive odds only)
function formatOdds(odds: number): string {
  return `+${odds}`
}

// Calculate all-time returns for a user (from resolved wagers)
// If "from" wins: from +amount, to -amount
// If "to" wins: to +(amount * odds/100), from -(amount * odds/100)
function calculateUserReturns(wagers: Wager[], user: string): number {
  return wagers
    .filter((w) => w.status === 'resolved' && (w.from_user === user || w.to_user === user))
    .reduce((total, wager) => {
      if (wager.result === 'push') return total

      const toWinAmount = wager.amount * (wager.odds / 100)

      if (wager.from_user === user) {
        return total + (wager.result === 'from' ? wager.amount : -toWinAmount)
      } else {
        return total + (wager.result === 'to' ? toWinAmount : -wager.amount)
      }
    }, 0)
}

// Calculate total amount wagered by a user (resolved wagers only)
function calculateTotalWagered(wagers: Wager[], user: string): number {
  return wagers
    .filter((w) => w.status === 'resolved' && (w.from_user === user || w.to_user === user))
    .reduce((total, wager) => {
      if (wager.from_user === user) {
        return total + wager.amount
      } else {
        return total + wager.amount * (wager.odds / 100)
      }
    }, 0)
}

// Calculate W-L-P record for a user
function calculateUserRecord(wagers: Wager[], user: string): { wins: number; losses: number; pushes: number } {
  const resolved = wagers.filter(
    (w) => w.status === 'resolved' && (w.from_user === user || w.to_user === user)
  )

  let wins = 0, losses = 0, pushes = 0

  for (const wager of resolved) {
    if (wager.result === 'push') {
      pushes++
    } else if (wager.from_user === user) {
      wager.result === 'from' ? wins++ : losses++
    } else {
      wager.result === 'to' ? wins++ : losses++
    }
  }

  return { wins, losses, pushes }
}

// Get exposure tier for user header tinting (0-3)
function getExposureTier(exposure: number, maxExposure: number): number {
  if (maxExposure === 0 || exposure === 0) return 0
  const ratio = exposure / maxExposure
  if (ratio < 0.25) return 0
  if (ratio < 0.5) return 1
  if (ratio < 0.75) return 2
  return 3
}

export default function Home() {
  // Auth state
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authEmail, setAuthEmail] = useState('')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // Derive current user's display name from auth email
  const currentUserName = user?.email ? EMAIL_TO_NAME[user.email.toLowerCase()] || null : null

  // Wagers state
  const [wagers, setWagers] = useState<Wager[]>([])
  const [loading, setLoading] = useState(true)
  const [currentActivityIndex, setCurrentActivityIndex] = useState(0)

  // Check auth and fetch wagers on mount
  useEffect(() => {
    // Bypass auth on localhost for development
    const isLocalhost = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

    if (isLocalhost) {
      setUser({ id: 'dev-user', email: 'dev@localhost' } as User)
      setAuthLoading(false)
      fetchWagers()
      return
    }

    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
      if (session?.user) {
        fetchWagers()
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          fetchWagers()
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const fetchWagers = async () => {
    const { data, error } = await supabase
      .from('wagers')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching wagers:', error)
    } else {
      setWagers(data || [])
    }
    setLoading(false)
  }

  // Reset handler - refetch from database
  const handleReset = () => {
    fetchWagers()
  }

  // Magic link authentication
  const handleSendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError(null)

    // Check if email is allowed
    const emailLower = authEmail.toLowerCase().trim()
    if (!ALLOWED_EMAILS.some(allowed => allowed.toLowerCase() === emailLower)) {
      setAuthError('This email is not authorized to access the Big Board.')
      return
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: authEmail,
      options: { emailRedirectTo: window.location.origin }
    })
    if (error) {
      setAuthError(error.message)
    } else {
      setMagicLinkSent(true)
    }
  }

  // Sign out handler
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  // Detail panel state
  const [selectedUserA, setSelectedUserA] = useState<string | null>(null)
  const [selectedUserB, setSelectedUserB] = useState<string | null>(null)
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false)

  // Focus mode: highlight a single user's row and column
  const [focusedUser, setFocusedUser] = useState<string | null>(null)

  // Pinned user: moves their row to top and column to left for easier tracking
  const [pinnedUser, setPinnedUser] = useState<string | null>(null)

  // Resolve wager state
  const [resolvingWagerId, setResolvingWagerId] = useState<string | null>(null)

  // Edit wager state
  const [editingWager, setEditingWager] = useState<Wager | null>(null)

  // Create wager modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [formFrom, setFormFrom] = useState('')
  const [formToUsers, setFormToUsers] = useState<string[]>([])
  const [formAmount, setFormAmount] = useState('')
  const [formOdds, setFormOdds] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Calculate all user exposures and rankings
  const userExposures = useMemo(() => {
    const exposures = USERS.map((user) => ({
      user,
      exposure: calculateUserExposure(wagers, user),
    }))
    return exposures.sort((a, b) => b.exposure - a.exposure)
  }, [wagers])

  const maxExposure = userExposures[0]?.exposure || 0
  const topExposedUser = userExposures[0]?.user

  // Calculate leaderboard based on all-time returns
  const leaderboard = useMemo(() => {
    return USERS
      .map((user) => ({
        user,
        returns: calculateUserReturns(wagers, user),
        totalWagered: calculateTotalWagered(wagers, user),
        record: calculateUserRecord(wagers, user),
      }))
      .sort((a, b) => b.returns - a.returns)
  }, [wagers])

  // Derive recent activity from wagers (creates, resolves)
  const recentActivity = useMemo(() => deriveActivityItems(wagers), [wagers])

  // Cycle through recent activity items every 4 seconds
  useEffect(() => {
    if (recentActivity.length <= 1) return
    const interval = setInterval(() => {
      setCurrentActivityIndex(prev => (prev + 1) % recentActivity.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [recentActivity.length])

  // Reset activity index when data changes
  useEffect(() => {
    setCurrentActivityIndex(0)
  }, [recentActivity])

  // Calculate dynamic heatmap thresholds based on current wager distribution
  const heatmapThresholds = useMemo((): HeatmapThresholds => {
    const amounts: number[] = []
    for (const rowUser of USERS) {
      for (const colUser of USERS) {
        if (rowUser !== colUser) {
          const amount = getCellData(wagers, rowUser, colUser).amount
          if (amount > 0) amounts.push(amount)
        }
      }
    }

    if (amounts.length === 0) return { low: 0, medium: 0 }

    amounts.sort((a, b) => a - b)
    const lowIndex = Math.floor(amounts.length / 3)
    const medIndex = Math.floor((amounts.length * 2) / 3)

    return {
      low: amounts[lowIndex] || amounts[0],
      medium: amounts[medIndex] || amounts[lowIndex] || amounts[0]
    }
  }, [wagers])

  const top3Users = new Set(
    userExposures
      .filter((u) => u.exposure > 0)
      .slice(0, 3)
      .map((u) => u.user)
  )

  // Get badge for user
  const getUserBadge = (user: string): string => {
    if (user === topExposedUser && maxExposure > 0) return ' 👑'
    if (top3Users.has(user) && user !== topExposedUser) return ' ⚠️'
    return ''
  }

  // Get exposure tint class for user
  const getUserExposureTintClass = (user: string): string => {
    const exposure = calculateUserExposure(wagers, user)
    const tier = getExposureTier(exposure, maxExposure)
    if (tier === 0) return ''
    return `exposure-tint-${tier}`
  }

  // Focus mode handler: toggle row+column highlight for a user
  const handleUserFocus = (user: string) => {
    setFocusedUser(prev => prev === user ? null : user)
  }

  // Pin handler: toggle pinned user (moves their row/column to top/left)
  const handlePinUser = (user: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent triggering focus mode
    setPinnedUser(prev => prev === user ? null : user)
  }

  // Sorted users: pinned user first, then alphabetical
  const sortedUsers = useMemo(() => {
    if (!pinnedUser) return USERS
    return [pinnedUser, ...USERS.filter(u => u !== pinnedUser)]
  }, [pinnedUser])

  // Detail panel handlers
  const handleCellClick = (rowUser: string, colUser: string) => {
    setSelectedUserA(rowUser)
    setSelectedUserB(colUser)
    setIsDetailPanelOpen(true)
    setResolvingWagerId(null)
  }

  const handleCloseDetailPanel = () => {
    setIsDetailPanelOpen(false)
    setSelectedUserA(null)
    setSelectedUserB(null)
    setResolvingWagerId(null)
  }

  // Create modal handlers
  const handleOpenCreateModal = () => {
    setIsCreateModalOpen(true)
    setFormFrom('')
    setFormToUsers([])
    setFormAmount('')
    setFormOdds('')
    setFormDescription('')
  }

  const handleCloseCreateModal = () => {
    setIsCreateModalOpen(false)
    setEditingWager(null)
    setFormFrom('')
    setFormToUsers([])
    setFormAmount('')
    setFormOdds('')
    setFormDescription('')
    setFormError(null)
  }

  const handleEditWager = (wager: Wager) => {
    setEditingWager(wager)
    setFormFrom(wager.from_user)
    setFormToUsers([wager.to_user])
    setFormDescription(wager.description)
    setFormAmount(String(wager.amount))
    setFormOdds(String(wager.odds))
    setFormError(null)
    setIsCreateModalOpen(true)
  }

  const handleToUserToggle = (user: string) => {
    setFormToUsers((prev) =>
      prev.includes(user) ? prev.filter((u) => u !== user) : [...prev, user]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setIsSubmitting(true)

    const amount = parseFloat(formAmount)
    const odds = parseInt(formOdds, 10)

    // Filter out the "from" user from "to" users
    const validToUsers = formToUsers.filter((u) => u !== formFrom)

    if (formFrom && validToUsers.length > 0 && amount > 0 && odds > 0 && formDescription.trim()) {
      if (editingWager) {
        // Update existing wager
        const { error } = await supabase
          .from('wagers')
          .update({
            description: formDescription.trim(),
            amount,
            odds,
          })
          .eq('id', editingWager.id)

        if (error) {
          console.error('Error updating wager:', error)
          setFormError(error.message || 'Failed to update wager')
          setIsSubmitting(false)
        } else {
          await fetchWagers()
          setToastMessage('Wager updated successfully!')
          setTimeout(() => setToastMessage(null), 3000)
          setIsSubmitting(false)
          handleCloseCreateModal()
        }
      } else {
        // Create one wager for each "to" user
        const newWagers = validToUsers.map((toUser) => ({
          from_user: formFrom,
          to_user: toUser,
          amount,
          odds,
          description: formDescription.trim(),
          status: 'open',
          created_by: currentUserName,
        }))

        const { error } = await supabase.from('wagers').insert(newWagers)

        if (error) {
          console.error('Error creating wagers:', error)
          setFormError(error.message || 'Failed to create wager')
          setIsSubmitting(false)
        } else {
          await fetchWagers()
          const count = validToUsers.length
          setToastMessage(`Wager${count > 1 ? 's' : ''} created successfully!`)
          setTimeout(() => setToastMessage(null), 3000)
          setIsSubmitting(false)
          handleCloseCreateModal()
        }
      }
    } else {
      setFormError('Please fill in all fields')
      setIsSubmitting(false)
    }
  }

  // Resolve wager handlers
  const handleStartResolve = (wagerId: string) => {
    setResolvingWagerId(wagerId)
  }

  const handleCancelResolve = () => {
    setResolvingWagerId(null)
  }

  const handleResolveWager = async (wagerId: string, result: 'from' | 'to' | 'push') => {
    const { error } = await supabase
      .from('wagers')
      .update({ status: 'resolved', result })
      .eq('id', wagerId)

    if (error) {
      console.error('Error resolving wager:', error)
    } else {
      await fetchWagers() // Refresh from database
    }
    setResolvingWagerId(null)
  }

  // Validation
  const amount = parseFloat(formAmount)
  const odds = parseInt(formOdds, 10)
  const validToUsers = formToUsers.filter((u) => u !== formFrom)
  const isFormValid =
    formFrom !== '' &&
    validToUsers.length > 0 &&
    !isNaN(amount) &&
    amount > 0 &&
    !isNaN(odds) &&
    odds > 0 &&
    formDescription.trim() !== ''

  // Get wagers from selectedUserA to selectedUserB (directional, including resolved)
  const selectedWagers =
    selectedUserA && selectedUserB
      ? wagers.filter(w => w.from_user === selectedUserA && w.to_user === selectedUserB)
      : []

  if (loading || authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Loading...
      </div>
    )
  }

  return (
    <div>
      <nav className={`top-nav ${!user ? 'blurred' : ''}`}>
        <span className="nav-brand">The Big Board</span>
        <div className="nav-actions">
          {user && (
            <button className="reset-button" onClick={handleSignOut}>
              Sign Out
            </button>
          )}
          <button className="reset-button" onClick={handleReset}>
            Refresh
          </button>
          <button className="create-wager-button" onClick={handleOpenCreateModal}>
            + Create Wager
          </button>
        </div>
      </nav>

      <main className={`main-content ${!user ? 'blurred' : ''}`}>
        {/* Recent Activity Strip */}
        <div className="activity-strip">
          <span className="activity-label">Recent:</span>
          <div className="activity-items">
            {recentActivity.length === 0 ? (
              <span className="activity-empty">No recent activity</span>
            ) : (
              <span key={recentActivity[currentActivityIndex].id} className="activity-item">
                <strong>{recentActivity[currentActivityIndex].user}</strong>
                {recentActivity[currentActivityIndex].type === 'created' ? (
                  <> created</>
                ) : (
                  <> resolved ({recentActivity[currentActivityIndex].result})</>
                )}
                {' vs '}<strong>{recentActivity[currentActivityIndex].opponent}</strong>
                <span className="activity-description">"{recentActivity[currentActivityIndex].description}"</span>
                <span className="activity-time">{formatRelativeTime(recentActivity[currentActivityIndex].timestamp)}</span>
              </span>
            )}
          </div>
        </div>

        <div className="grid-container">
        <table>
          <thead>
            <tr>
              <th className="corner-label">
                <span className="direction-hint from">From ↓</span>
                <span className="direction-hint to">To →</span>
              </th>
              {sortedUsers.map((colUser) => (
                <th
                  key={colUser}
                  className={`column-header clickable ${focusedUser === colUser ? 'focused' : ''} ${pinnedUser === colUser ? 'pinned' : ''}`}
                  onClick={() => handleUserFocus(colUser)}
                >
                  {colUser}
                </th>
              ))}
              <th className="exposure-header">Exposure</th>
            </tr>
          </thead>
          <tbody>
            {sortedUsers.map((rowUser) => (
              <tr key={rowUser} className={pinnedUser === rowUser ? 'pinned-row' : ''}>
                <td
                  className={`header-cell clickable ${getUserExposureTintClass(rowUser)} ${focusedUser === rowUser ? 'focused' : ''} ${pinnedUser === rowUser ? 'pinned' : ''}`}
                  onClick={() => handleUserFocus(rowUser)}
                >
                  <button
                    className={`pin-button ${pinnedUser === rowUser ? 'pinned' : ''}`}
                    onClick={(e) => handlePinUser(rowUser, e)}
                    title={pinnedUser === rowUser ? 'Unpin user' : 'Pin user'}
                  >
                    📌
                  </button>
                  <span className="header-name">{rowUser}</span>
                  {getUserBadge(rowUser)}
                </td>
                {sortedUsers.map((colUser) => {
                  const cellData = getCellData(wagers, rowUser, colUser)
                  const heatmapClass = getCellHeatmapClass(cellData.amount, heatmapThresholds)
                  // Diagonal: same user (rowUser === colUser), not based on index
                  const isDiagonal = rowUser === colUser
                  // Focus mode: cell is highlighted if in focused user's row or column
                  const isInFocusedRowOrCol = focusedUser && (rowUser === focusedUser || colUser === focusedUser)
                  const focusClass = focusedUser
                    ? (isInFocusedRowOrCol ? 'cell-focused' : 'cell-unfocused')
                    : ''
                  return (
                    <td
                      key={colUser}
                      className={
                        isDiagonal
                          ? `diagonal ${focusClass}`
                          : `wager-cell clickable ${heatmapClass} ${focusClass}`
                      }
                      onClick={
                        !isDiagonal
                          ? () => handleCellClick(rowUser, colUser)
                          : undefined
                      }
                    >
                      {isDiagonal ? (
                        '—'
                      ) : (
                        <div className="cell-content">
                          <span className="cell-amount">${cellData.amount}</span>
                          <span className="cell-count">
                            {cellData.count} wager{cellData.count !== 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                    </td>
                  )
                })}
                <td className={`exposure-cell ${focusedUser ? (rowUser === focusedUser ? 'cell-focused' : 'cell-unfocused') : ''}`}>
                  ${Math.round(calculateUserExposure(wagers, rowUser))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Leaderboard */}
      <div className="leaderboard">
        <h2 className="leaderboard-title">Leaderboard</h2>
        <div className="leaderboard-header">
          <span className="leaderboard-rank"></span>
          <span className="leaderboard-name">Player</span>
          <span className="leaderboard-record">Record</span>
          <span className="leaderboard-wagered">Wagered</span>
          <span className="leaderboard-returns">Returns</span>
        </div>
        <div className="leaderboard-list">
          {leaderboard.map((entry, index) => (
            <div key={entry.user} className="leaderboard-item">
              <span className="leaderboard-rank">#{index + 1}</span>
              <span className="leaderboard-name">{entry.user}</span>
              <span className="leaderboard-record">
                {entry.record.wins}-{entry.record.losses}-{entry.record.pushes}
              </span>
              <span className="leaderboard-wagered">
                ${Math.round(entry.totalWagered)}
              </span>
              <span className={`leaderboard-returns ${entry.returns >= 0 ? 'positive' : 'negative'}`}>
                {entry.returns >= 0 ? '+' : ''}${Math.round(entry.returns)}
              </span>
            </div>
          ))}
        </div>
      </div>
      </main>

      {/* Wager Detail Panel */}
      {isDetailPanelOpen && selectedUserA && selectedUserB && (
        <div className="panel-overlay" onClick={handleCloseDetailPanel}>
          <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h2>
                {selectedUserA} &rarr; {selectedUserB}
              </h2>
              <button className="close-button" onClick={handleCloseDetailPanel}>
                &times;
              </button>
            </div>
            <div className="panel-content">
              {selectedWagers.length === 0 ? (
                <p className="no-wagers">No wagers between these users.</p>
              ) : (
                <ul className="wager-list">
                  {selectedWagers.map((wager) => (
                    <li
                      key={wager.id}
                      className={`wager-item ${wager.status === 'resolved' ? 'resolved' : ''}`}
                    >
                      <div className="wager-header">
                        <span className="wager-direction">
                          {wager.from_user} &rarr; {wager.to_user}
                        </span>
                        <span className={`wager-status status-${wager.status}`}>
                          {wager.status === 'open' ? 'Open' : 'Resolved'}
                        </span>
                      </div>
                      <p className="wager-description">{wager.description}</p>
                      <div className="wager-details">
                        <span>${wager.amount} at {formatOdds(wager.odds)}</span>
                        {wager.status === 'resolved' && wager.result && (
                          <span className="wager-result">
                            {wager.result === 'from' && `${wager.from_user} won`}
                            {wager.result === 'to' && `${wager.to_user} won`}
                            {wager.result === 'push' && 'Push'}
                          </span>
                        )}
                      </div>
                      <div className="wager-meta">
                        {wager.created_by && <span>Created by {wager.created_by}</span>}
                        {wager.created_at && (
                          <span>{new Date(wager.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        )}
                      </div>

                      {wager.status === 'open' && resolvingWagerId !== wager.id && (
                        <div className="wager-actions">
                          <button
                            className="edit-button"
                            onClick={() => handleEditWager(wager)}
                          >
                            Edit
                          </button>
                          <button
                            className="resolve-button"
                            onClick={() => handleStartResolve(wager.id)}
                          >
                            Resolve
                          </button>
                        </div>
                      )}

                      {resolvingWagerId === wager.id && (
                        <div className="resolve-panel">
                          <p className="resolve-title">Select outcome:</p>
                          <div className="resolve-options">
                            <button
                              className="resolve-option from-wins"
                              onClick={() => handleResolveWager(wager.id, 'from')}
                            >
                              {wager.from_user} wins
                            </button>
                            <button
                              className="resolve-option to-wins"
                              onClick={() => handleResolveWager(wager.id, 'to')}
                            >
                              {wager.to_user} wins
                            </button>
                            <button
                              className="resolve-option push"
                              onClick={() => handleResolveWager(wager.id, 'push')}
                            >
                              Push / Cancel
                            </button>
                          </div>
                          <button
                            className="resolve-cancel"
                            onClick={handleCancelResolve}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Wager Modal */}
      {isCreateModalOpen && (
        <div className="panel-overlay" onClick={handleCloseCreateModal}>
          <div className="detail-panel create-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-header">
              <h2>{editingWager ? 'Edit Wager' : 'Create New Wager'}</h2>
              <button className="close-button" onClick={handleCloseCreateModal}>
                &times;
              </button>
            </div>
            <div className="panel-content">
              <form className="wager-form" onSubmit={handleSubmit}>
                {editingWager ? (
                  <div className="form-group">
                    <label className="form-label">Participants</label>
                    <p className="form-readonly">{editingWager.from_user} &rarr; {editingWager.to_user}</p>
                  </div>
                ) : (
                  <>
                    <div className="form-group">
                      <label className="form-label">From</label>
                      <select
                        value={formFrom}
                        onChange={(e) => { setFormFrom(e.target.value); setFormToUsers([]); }}
                        className="form-select"
                      >
                        <option value="">Select person...</option>
                        {USERS.map((user) => (
                          <option key={user} value={user}>
                            {user}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        To (select one or more opponents)
                      </label>
                      {!formFrom && (
                        <p className="form-hint">Select a "From" person first</p>
                      )}
                      <div className={`checkbox-grid ${!formFrom ? 'disabled-grid' : ''}`}>
                        {USERS.map((user) => (
                          <label
                            key={user}
                            className={`checkbox-item ${
                              !formFrom || user === formFrom ? 'disabled' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={formToUsers.includes(user)}
                              onChange={() => handleToUserToggle(user)}
                              disabled={!formFrom || user === formFrom}
                            />
                            <span>{user}</span>
                          </label>
                        ))}
                      </div>
                      {formToUsers.length > 0 && (
                        <p className="selected-count">
                          {validToUsers.length} opponent
                          {validToUsers.length !== 1 ? 's' : ''} selected
                        </p>
                      )}
                    </div>
                  </>
                )}

                <div className="form-group">
                  <label className="form-label">Description *</label>
                  {validToUsers.length === 0 && (
                    <p className="form-hint">Select opponent(s) first</p>
                  )}
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="What is the wager about?"
                    className={`form-textarea${validToUsers.length === 0 ? ' disabled-field' : ''}`}
                    rows={2}
                    disabled={validToUsers.length === 0}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Amount ($)</label>
                    {!formDescription.trim() && (
                      <p className="form-hint">Enter a description first</p>
                    )}
                    <input
                      type="number"
                      min="1"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      placeholder="100"
                      className={`form-input${!formDescription.trim() ? ' disabled-field' : ''}`}
                      disabled={!formDescription.trim()}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Odds (+)</label>
                    {!formDescription.trim() && (
                      <p className="form-hint">Enter a description first</p>
                    )}
                    <input
                      type="number"
                      min="1"
                      value={formOdds}
                      onChange={(e) => setFormOdds(e.target.value)}
                      placeholder="100"
                      className={`form-input${!formDescription.trim() ? ' disabled-field' : ''}`}
                      disabled={!formDescription.trim()}
                    />
                  </div>
                </div>

                {formFrom && formToUsers.includes(formFrom) && (
                  <p className="form-error">
                    Cannot wager against yourself (removed from selection)
                  </p>
                )}

                {formError && (
                  <p className="form-error">{formError}</p>
                )}

                <div className="form-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={handleCloseCreateModal}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="submit-button"
                    disabled={!isFormValid || isSubmitting}
                  >
                    {editingWager
                      ? (isSubmitting ? 'Saving...' : 'Save Changes')
                      : (isSubmitting ? 'Creating...' : `Create ${validToUsers.length > 1 ? `${validToUsers.length} Wagers` : 'Wager'}`)
                    }
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {toastMessage && (
        <div className="toast">{toastMessage}</div>
      )}

      {/* Auth Overlay */}
      {!user && (
        <div className="auth-overlay">
          <div className="auth-modal">
            <h2>The Big Board</h2>
            <p className="auth-subtitle">Sign in to access the wager board</p>
            {magicLinkSent ? (
              <div className="auth-success">
                <p>Magic link sent!</p>
                <p className="auth-hint">Check your email and click the link to sign in.</p>
              </div>
            ) : (
              <form onSubmit={handleSendMagicLink} className="auth-form">
                <input
                  type="email"
                  placeholder="Enter your email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="auth-input"
                  required
                />
                {authError && <p className="form-error">{authError}</p>}
                <button type="submit" className="auth-button">
                  Send Magic Link
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
