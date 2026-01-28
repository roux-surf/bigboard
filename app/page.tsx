'use client'

import { useState, useMemo } from 'react'

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

// Fractional odds data model
interface FractionalOdds {
  numerator: number   // What you win
  denominator: number // What you risk
}

// Wager data model
interface Wager {
  id: string
  from: string
  to: string
  amount: number
  odds: FractionalOdds
  description: string
  status: 'open' | 'resolved'
  result?: 'from' | 'to' | 'push'
}

// Generate unique ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

// Initial sample wagers
const INITIAL_WAGERS: Wager[] = [
  { id: generateId(), from: 'Will', to: 'John', amount: 100, odds: -110, description: 'Chiefs vs Eagles Super Bowl', status: 'open' },
  { id: generateId(), from: 'John', to: 'Will', amount: 50, odds: +150, description: 'Lakers win Western Conference', status: 'open' },
  { id: generateId(), from: 'Chas', to: 'Clay', amount: 200, odds: -200, description: 'Bitcoin above 50k by March', status: 'open' },
  { id: generateId(), from: 'Craig', to: 'Daniel', amount: 75, odds: +120, description: 'Yankees make playoffs', status: 'open' },
  { id: generateId(), from: 'Matt', to: 'Nick', amount: 150, odds: -110, description: 'UFC 300 main event goes to decision', status: 'open' },
  { id: generateId(), from: 'Ryan', to: 'Sean', amount: 100, odds: +200, description: 'Tesla stock above 300 by EOY', status: 'open' },
  { id: generateId(), from: 'Ted', to: 'Zac', amount: 250, odds: -150, description: 'Celtics win NBA Championship', status: 'open' },
  { id: generateId(), from: 'Will', to: 'Chas', amount: 100, odds: +100, description: 'Next Marvel movie over 1B box office', status: 'open' },
  { id: generateId(), from: 'John', to: 'Clay', amount: 80, odds: -110, description: 'Dodgers win World Series', status: 'resolved', result: 'from' },
  { id: generateId(), from: 'Sean', to: 'Ted', amount: 120, odds: +180, description: 'Snow in Austin before December', status: 'resolved', result: 'to' },
]

// Heatmap thresholds (dollar amounts)
const HEATMAP_LOW_MAX = 100
const HEATMAP_MEDIUM_MAX = 500

// Get all wagers between two users (both directions) - only open wagers for grid
function getWagersBetweenUsers(wagers: Wager[], user1: string, user2: string, openOnly: boolean = false): Wager[] {
  return wagers.filter(
    (wager) =>
      ((wager.from === user1 && wager.to === user2) ||
      (wager.from === user2 && wager.to === user1)) &&
      (!openOnly || wager.status === 'open')
  )
}

// Get total dollar amount between two users (open wagers only)
function getCellAmount(wagers: Wager[], user1: string, user2: string): number {
  const userWagers = getWagersBetweenUsers(wagers, user1, user2, true)
  return userWagers.reduce((sum, wager) => sum + wager.amount, 0)
}

// Get heatmap class based on cell amount
function getCellHeatmapClass(amount: number): string {
  if (amount === 0) return ''
  if (amount <= HEATMAP_LOW_MAX) return 'heat-low'
  if (amount <= HEATMAP_MEDIUM_MAX) return 'heat-medium'
  return 'heat-high'
}

// Calculate odds multiplier for exposure
function getOddsMultiplier(odds: number): number {
  if (odds < 0) {
    return 1.0 // Negative odds: risk amount to win less
  }
  return 1 + odds / 100 // Positive odds: potential winnings
}

// Calculate total exposure for a user (open wagers they placed)
function calculateUserExposure(wagers: Wager[], user: string): number {
  return wagers
    .filter((wager) => wager.from === user && wager.status === 'open')
    .reduce((total, wager) => {
      return total + wager.amount * getOddsMultiplier(wager.odds)
    }, 0)
}

// Get cell data for wagers from one user to another (directional, open wagers only)
function getCellData(wagers: Wager[], fromUser: string, toUser: string): { amount: number; count: number } {
  const userWagers = wagers.filter(
    w => w.from === fromUser && w.to === toUser && w.status === 'open'
  )
  const totalAmount = userWagers.reduce((sum, wager) => sum + wager.amount, 0)
  return { amount: totalAmount, count: userWagers.length }
}

// Format odds for display
function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`
}

// Calculate all-time returns for a user (from resolved wagers)
function calculateUserReturns(wagers: Wager[], user: string): number {
  return wagers
    .filter((w) => w.status === 'resolved' && (w.from === user || w.to === user))
    .reduce((total, wager) => {
      if (wager.result === 'push') return total

      // Calculate what "from" user would win based on odds
      const fromProfit = wager.odds < 0
        ? wager.amount * (100 / Math.abs(wager.odds))
        : wager.amount * (wager.odds / 100)

      if (wager.from === user) {
        // User placed the wager
        return total + (wager.result === 'from' ? fromProfit : -wager.amount)
      } else {
        // User was the counterparty
        return total + (wager.result === 'to' ? wager.amount : -fromProfit)
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
  // Wagers state (initialized with sample data)
  const [wagers, setWagers] = useState<Wager[]>(INITIAL_WAGERS)

  // Reset handler
  const handleReset = () => {
    setWagers(INITIAL_WAGERS.map(w => ({ ...w, id: generateId() })))
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
  }

  const handleToUserToggle = (user: string) => {
    setFormToUsers((prev) =>
      prev.includes(user) ? prev.filter((u) => u !== user) : [...prev, user]
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseFloat(formAmount)
    const odds = parseInt(formOdds, 10)

    // Filter out the "from" user from "to" users
    const validToUsers = formToUsers.filter((u) => u !== formFrom)

    if (formFrom && validToUsers.length > 0 && amount > 0 && odds !== 0 && formDescription.trim()) {
      // Create one wager for each "to" user
      const newWagers: Wager[] = validToUsers.map((toUser) => ({
        id: generateId(),
        from: formFrom,
        to: toUser,
        amount,
        odds,
        description: formDescription.trim(),
        status: 'open',
      }))
      setWagers([...wagers, ...newWagers])
      handleCloseCreateModal()
    }
  }

  // Resolve wager handlers
  const handleStartResolve = (wagerId: string) => {
    setResolvingWagerId(wagerId)
  }

  const handleCancelResolve = () => {
    setResolvingWagerId(null)
  }

  const handleResolveWager = (wagerId: string, result: 'from' | 'to' | 'push') => {
    setWagers((prev) =>
      prev.map((wager) =>
        wager.id === wagerId
          ? { ...wager, status: 'resolved' as const, result }
          : wager
      )
    )
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
    odds !== 0 &&
    formDescription.trim() !== ''

  // Get wagers from selectedUserA to selectedUserB (directional, including resolved)
  const selectedWagers =
    selectedUserA && selectedUserB
      ? wagers.filter(w => w.from === selectedUserA && w.to === selectedUserB)
      : []

  return (
    <div>
      <nav className="top-nav">
        <span className="nav-brand">The Big Board</span>
        <div className="nav-actions">
          <button className="reset-button" onClick={handleReset}>
            Reset
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
                  const heatmapClass = getCellHeatmapClass(cellData.amount)
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
          <span>Low ($1-100)</span>
        </div>
        <div className="legend-item">
          <div className="legend-swatch medium"></div>
          <span>Medium ($101-500)</span>
        </div>
        <div className="legend-item">
          <div className="legend-swatch high"></div>
          <span>High ($500+)</span>
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
                          {wager.from} &rarr; {wager.to}
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
                            {wager.result === 'from' && `${wager.from} won`}
                            {wager.result === 'to' && `${wager.to} won`}
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
                              {wager.from} wins
                            </button>
                            <button
                              className="resolve-option to-wins"
                              onClick={() => handleResolveWager(wager.id, 'to')}
                            >
                              {wager.to} wins
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
                    <label className="form-label">Odds</label>
                    <input
                      type="number"
                      value={formOdds}
                      onChange={(e) => setFormOdds(e.target.value)}
                      placeholder="-110"
                      className="form-input"
                    />
                  </div>
                </div>

                {formFrom && formToUsers.includes(formFrom) && (
                  <p className="form-error">
                    Cannot wager against yourself (removed from selection)
                  </p>
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
                    disabled={!isFormValid}
                  >
                    Create {validToUsers.length > 1 ? `${validToUsers.length} Wagers` : 'Wager'}
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
