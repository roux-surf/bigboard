'use client'

import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabase'

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
  'Will',
  'Zac',
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
}

// Heatmap threshold type
interface HeatmapThresholds {
  low: number
  medium: number
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
  // Wagers state
  const [wagers, setWagers] = useState<Wager[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch wagers from Supabase on mount
  useEffect(() => {
    fetchWagers()
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

  // Detail panel state
  const [selectedUserA, setSelectedUserA] = useState<string | null>(null)
  const [selectedUserB, setSelectedUserB] = useState<string | null>(null)
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false)

  // Resolve wager state
  const [resolvingWagerId, setResolvingWagerId] = useState<string | null>(null)

  // Create wager modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [formFrom, setFormFrom] = useState('')
  const [formToUsers, setFormToUsers] = useState<string[]>([])
  const [formAmount, setFormAmount] = useState('')
  const [formOdds, setFormOdds] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
      }))
      .sort((a, b) => b.returns - a.returns)
  }, [wagers])

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
    setFormFrom('')
    setFormToUsers([])
    setFormAmount('')
    setFormOdds('')
    setFormDescription('')
    setFormError(null)
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
      // Create one wager for each "to" user
      const newWagers = validToUsers.map((toUser) => ({
        from_user: formFrom,
        to_user: toUser,
        amount,
        odds,
        description: formDescription.trim(),
        status: 'open',
      }))

      const { error } = await supabase.from('wagers').insert(newWagers)

      if (error) {
        console.error('Error creating wagers:', error)
        setFormError(error.message || 'Failed to create wager')
        setIsSubmitting(false)
      } else {
        await fetchWagers() // Refresh from database
        setIsSubmitting(false)
        handleCloseCreateModal()
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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        Loading...
      </div>
    )
  }

  return (
    <div>
      <nav className="top-nav">
        <span className="nav-brand">The Big Board</span>
        <div className="nav-actions">
          <button className="reset-button" onClick={handleReset}>
            Refresh
          </button>
          <button className="create-wager-button" onClick={handleOpenCreateModal}>
            + Create Wager
          </button>
        </div>
      </nav>

      <main className="main-content">
        <div className="grid-container">
        <table>
          <thead>
            <tr>
              <th></th>
              {USERS.map((user) => (
                <th key={user}>{user}</th>
              ))}
              <th className="exposure-header">Exposure</th>
            </tr>
          </thead>
          <tbody>
            {USERS.map((rowUser, rowIndex) => (
              <tr key={rowUser}>
                <td
                  className={`header-cell ${getUserExposureTintClass(rowUser)}`}
                >
                  {rowUser}
                  {getUserBadge(rowUser)}
                </td>
                {USERS.map((colUser, colIndex) => {
                  const cellData = getCellData(wagers, rowUser, colUser)
                  const heatmapClass = getCellHeatmapClass(cellData.amount, heatmapThresholds)
                  return (
                    <td
                      key={colUser}
                      className={
                        rowIndex === colIndex
                          ? 'diagonal'
                          : `wager-cell clickable ${heatmapClass}`
                      }
                      onClick={
                        rowIndex !== colIndex
                          ? () => handleCellClick(rowUser, colUser)
                          : undefined
                      }
                    >
                      {rowIndex === colIndex ? (
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
                <td className="exposure-cell">
                  ${Math.round(calculateUserExposure(wagers, rowUser))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Heatmap Legend */}
      <div className="legend-container">
        <div className="legend-item">
          <div className="legend-swatch low"></div>
          <span>Low ($1-{heatmapThresholds.low || '?'})</span>
        </div>
        <div className="legend-item">
          <div className="legend-swatch medium"></div>
          <span>Medium (${heatmapThresholds.low + 1 || '?'}-{heatmapThresholds.medium || '?'})</span>
        </div>
        <div className="legend-item">
          <div className="legend-swatch high"></div>
          <span>High (${heatmapThresholds.medium + 1 || '?'}+)</span>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="leaderboard">
        <h2 className="leaderboard-title">All-Time Returns</h2>
        <div className="leaderboard-list">
          {leaderboard.map((entry, index) => (
            <div key={entry.user} className="leaderboard-item">
              <span className="leaderboard-rank">#{index + 1}</span>
              <span className="leaderboard-name">{entry.user}</span>
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

                      {wager.status === 'open' && resolvingWagerId !== wager.id && (
                        <button
                          className="resolve-button"
                          onClick={() => handleStartResolve(wager.id)}
                        >
                          Resolve
                        </button>
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
              <h2>Create New Wager</h2>
              <button className="close-button" onClick={handleCloseCreateModal}>
                &times;
              </button>
            </div>
            <div className="panel-content">
              <form className="wager-form" onSubmit={handleSubmit}>
                <div className="form-group">
                  <label className="form-label">From</label>
                  <select
                    value={formFrom}
                    onChange={(e) => setFormFrom(e.target.value)}
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
                  <div className="checkbox-grid">
                    {USERS.map((user) => (
                      <label
                        key={user}
                        className={`checkbox-item ${
                          user === formFrom ? 'disabled' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formToUsers.includes(user)}
                          onChange={() => handleToUserToggle(user)}
                          disabled={user === formFrom}
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

                <div className="form-group">
                  <label className="form-label">Description *</label>
                  <textarea
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="What is the wager about?"
                    className="form-textarea"
                    rows={2}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Amount ($)</label>
                    <input
                      type="number"
                      min="1"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      placeholder="100"
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Odds (+)</label>
                    <input
                      type="number"
                      min="1"
                      value={formOdds}
                      onChange={(e) => setFormOdds(e.target.value)}
                      placeholder="100"
                      className="form-input"
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
                    {isSubmitting ? 'Creating...' : `Create ${validToUsers.length > 1 ? `${validToUsers.length} Wagers` : 'Wager'}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
