import { useParams } from "react-router-dom";
import { useEffect, useState, useMemo, useRef } from "react";
import Header from "../components/Header";

const RepoPage = () => {
  const { owner, repo } = useParams();
  const [contributors, setContributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState(null);
  const [commits, setCommits] = useState([]);
  const [repoMeta, setRepoMeta] = useState(null);

  const [rateLimitModal, setRateLimitModal] = useState(null);
  const [isCachedData, setIsCachedData] = useState(false);
  const [cacheTimestamp, setCacheTimestamp] = useState(null);
  const [nextRefreshTime, setNextRefreshTime] = useState(null);
  const [timeUntilRefresh, setTimeUntilRefresh] = useState(null);
  const [lastRefreshTime, setLastRefreshTime] = useState(null);

  // Cache management functions
  const getCacheKey = (type) => `github-stats-${owner}-${repo}-${type}`;

  const saveToCache = (type, data) => {
    try {
      const cacheData = {
        data,
        timestamp: Date.now(),
      };
      localStorage.setItem(getCacheKey(type), JSON.stringify(cacheData));
    } catch (err) {
      console.warn("Failed to save to cache:", err);
    }
  };

  const getFromCache = (type) => {
    try {
      const cached = localStorage.getItem(getCacheKey(type));
      if (cached) {
        const parsed = JSON.parse(cached);

        // If it's commits data, restore Date objects
        if (type === "commits" && Array.isArray(parsed.data)) {
          parsed.data = parsed.data.map((commit) => ({
            ...commit,
            date: new Date(commit.date), // Convert string back to Date
          }));
        }

        return parsed;
      }
    } catch (err) {
      console.warn("Failed to load from cache:", err);
    }
    return null;
  };

  const formatCacheTime = (timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const now = new Date();
  const defaultUntil = new Date(now);
  const defaultSince = new Date(now);
  defaultSince.setDate(defaultSince.getDate() - 1);
  const [since, setSince] = useState(defaultSince);
  const [until, setUntil] = useState(defaultUntil);

  useEffect(() => {
    const fetchContributors = async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contributors`,
        );

        if (!res.ok) {
          throw new Error("Failed to fetch contributors");
        }

        try {
          const data = await res.json();
          if (Array.isArray(data)) {
            setContributors(data);
            saveToCache("contributors", data);
            setIsCachedData(false);
          } else {
            // If response is not an array, treat as empty
            setContributors([]);
            saveToCache("contributors", []);
            setIsCachedData(false);
          }
        } catch (jsonErr) {
          // Handle JSON parsing errors (empty response, etc.)
          console.warn("Failed to parse contributors JSON:", jsonErr);
          setContributors([]);
          saveToCache("contributors", []);
          setIsCachedData(false);
        }
      } catch (err) {
        const cached = getFromCache("contributors");
        if (cached) {
          setContributors(cached.data);
          setCacheTimestamp(cached.timestamp);
          setIsCachedData(true);
        } else {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchContributors();
  }, [owner, repo]);

  useEffect(() => {
    const fetchRepoMeta = async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}`,
        );
        if (res.ok) {
          try {
            const data = await res.json();
            setRepoMeta(data);
            saveToCache("repoMeta", data);
          } catch (jsonErr) {
            // Handle JSON parsing errors
            console.warn("Failed to parse repo metadata JSON:", jsonErr);
          }
        }
      } catch (err) {
        const cached = getFromCache("repoMeta");
        if (cached) {
          setRepoMeta(cached.data);
        } else {
          console.error("Failed to fetch repo metadata:", err);
        }
      }
    };

    if (owner && repo) fetchRepoMeta();
  }, [owner, repo]);

  const handleRateLimit = (res) => {
    const retryAfter = res.headers.get("retry-after");
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");

    let waitSeconds = 60;

    if (retryAfter) {
      waitSeconds = parseInt(retryAfter, 10);
    } else if (remaining === "0" && reset) {
      const resetTime = parseInt(reset, 10) * 1000;
      const now = Date.now();
      waitSeconds = Math.ceil((resetTime - now) / 1000);
    }

    const resetDate = new Date(Date.now() + waitSeconds * 1000);
    setNextRefreshTime(resetDate.getTime());

    setRateLimitModal({
      waitSeconds,
      resetDate: resetDate.toLocaleString(),
      resetTime: resetDate.toLocaleTimeString(),
    });

    setCommitsError(null);
  };

  const fetchCommits = async () => {
    setCommitsLoading(true);
    setCommitsError(null);
    setRateLimitModal(null);

    try {
      const allCommits = [];
      let page = 1;
      const perPage = 100;
      let hasMore = true;

      const sinceISO = since.toISOString();
      const untilISO = until.toISOString();

      console.log("Fetching commits from", sinceISO, "to", untilISO);

      while (hasMore && page <= 10) {
        const url = `https://api.github.com/repos/${owner}/${repo}/commits?since=${sinceISO}&until=${untilISO}&per_page=${perPage}&page=${page}`;
        console.log("Fetching page", page);

        const res = await fetch(url);

        if (res.status === 403 || res.status === 429) {
          handleRateLimit(res);
          throw new Error(
            "GitHub API rate limit exceeded. Please wait before refreshing.",
          );
        }

        if (!res.ok) {
          throw new Error(
            `Failed to fetch commits: ${res.status} ${res.statusText}`,
          );
        }

        const data = await res.json();
        console.log(`Page ${page}: Got ${data.length} commits`);

        if (data.length === 0) {
          hasMore = false;
        } else {
          allCommits.push(...data);
          page++;

          if (data.length < perPage) {
            hasMore = false;
          }
        }
      }

      console.log(`Total commits fetched: ${allCommits.length}`);

      const commitsWithStats = [];

      const batchSize = 5;
      for (let i = 0; i < Math.min(allCommits.length, 200); i += batchSize) {
        const batch = allCommits.slice(i, i + batchSize);

        const batchPromises = batch.map(async (commit) => {
          try {
            const detailRes = await fetch(commit.url);

            if (detailRes.status === 403 || detailRes.status === 429) {
              handleRateLimit(detailRes);
              throw new Error(
                "GitHub API rate limit exceeded. Please wait before refreshing.",
              );
            }

            if (!detailRes.ok) {
              console.warn(`Failed to fetch details for commit ${commit.sha}`);
              return null;
            }

            const detail = await detailRes.json();

            return {
              sha: commit.sha,
              date: new Date(commit.commit.author.date),
              message: commit.commit.message,
              author: commit.commit.author.name,
              authorAvatar: commit.author?.avatar_url || null,
              additions: detail.stats?.additions || 0,
              deletions: detail.stats?.deletions || 0,
              total: detail.stats?.total || 0,
              filesChanged: detail.files?.length || 0,
              url: commit.html_url,
            };
          } catch (err) {
            console.warn(`Error fetching commit ${commit.sha}:`, err);
            return null;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        commitsWithStats.push(...batchResults.filter(Boolean));

        console.log(`Processed ${commitsWithStats.length} commits with stats`);

        if (i + batchSize < allCommits.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      setCommits(commitsWithStats);
      saveToCache("commits", commitsWithStats);
      setIsCachedData(false);
      setLastRefreshTime(new Date());
      console.log("Final commits with stats:", commitsWithStats.length);
    } catch (err) {
      console.error("Fetch commits error:", err);

      if (err.message.includes("rate limit")) {
        const cached = getFromCache("commits");
        if (cached) {
          setCommits(cached.data);
          setCacheTimestamp(cached.timestamp);
          setIsCachedData(true);
          setCommitsError(
            "Showing cached data from " +
              formatCacheTime(cached.timestamp) +
              ". Please wait before refreshing.",
          );
        } else {
          setCommitsError(err.message);
        }
      } else {
        setCommitsError(err.message);
      }
    } finally {
      setCommitsLoading(false);
    }
  };

  useEffect(() => {
    if (owner && repo && since && until) {
      fetchCommits();
    }
  }, []);

  useEffect(() => {
    if (!nextRefreshTime) {
      setTimeUntilRefresh(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, nextRefreshTime - now);

      if (remaining <= 0) {
        setTimeUntilRefresh(null);
        setNextRefreshTime(null);
      } else {
        setTimeUntilRefresh(Math.ceil(remaining / 1000));
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [nextRefreshTime]);

  const filteredCommits = useMemo(() => {
    const sinceMs = since ? since.getTime() : -Infinity;
    const untilMs = until ? until.getTime() : Infinity;

    return commits.filter((c) => {
      const commitMs = c.date.getTime();
      return commitMs >= sinceMs && commitMs <= untilMs;
    });
  }, [commits, since, until]);

  const stats = useMemo(() => {
    const totalCommits = filteredCommits.length;
    const totalAdditions = filteredCommits.reduce((s, v) => s + v.additions, 0);
    const totalDeletions = filteredCommits.reduce((s, v) => s + v.deletions, 0);
    const netLines = totalAdditions - totalDeletions;

    return {
      totalCommits,
      totalAdditions,
      totalDeletions,
      netLines,
    };
  }, [filteredCommits]);

  const toLocalInput = (d) => {
    if (!d) return "";
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  };

  const RateLimitWarning = ({ data, onClose }) => {
    const [timeLeft, setTimeLeft] = useState(data.waitSeconds);

    useEffect(() => {
      if (timeLeft <= 0) return;
      const interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }, [timeLeft]);

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 border-2 border-red-500 rounded-lg shadow-2xl max-w-md w-full p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-xl font-bold text-red-400">
              Rate Limit Exceeded
            </h2>
          </div>

          <p className="text-gray-200 mb-4">
            You've hit GitHub's API rate limit. Please wait before refreshing
            again.
          </p>

          <div className="bg-slate-700 border border-slate-600 rounded p-4 mb-4">
            <div className="text-sm text-gray-400 mb-2">
              ⏱️ Time until next refresh:
            </div>
            <div className="text-3xl font-mono font-bold text-sky-400">
              {String(minutes).padStart(2, "0")}:
              {String(seconds).padStart(2, "0")}
            </div>
            <div className="text-xs text-gray-400 mt-2">
              Retry after:{" "}
              <span className="text-gray-200">{data.resetDate}</span>
            </div>
          </div>

          <div className="bg-slate-700 border border-slate-600 rounded p-4 mb-4">
            <div className="text-sm text-gray-300 mb-2">💡 Suggestions:</div>
            <ul className="text-sm text-gray-400 space-y-1">
              <li>• Use a VPN to change your IP address</li>
              <li>• Switch to a different WiFi network</li>
              <li>• Switch to mobile data or vice versa</li>
              <li>• Wait for the timer and refresh after</li>
            </ul>
          </div>

          <button
            className="w-full bg-sky-600 hover:bg-sky-500 text-white px-4 py-2 rounded font-medium transition"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    );
  };

  const CommitGraph = ({ commits }) => {
    const [hoveredCommit, setHoveredCommit] = useState(null);
    const containerRef = useRef(null);
    const svgRef = useRef(null);
    const tooltipRef = useRef(null);

    if (!commits || commits.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-400 bg-slate-800 rounded border border-slate-700">
          No commits in this time range
        </div>
      );
    }

    const dates = commits.map((c) => c.date.getTime());
    const values = commits.map((c) => c.total);

    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const maxValue = Math.max(...values, 1);

    const w = 900;
    const h = 300;
    const padding = { top: 30, right: 30, bottom: 50, left: 70 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const points = commits.map((commit, i) => {
      const x =
        padding.left +
        ((dates[i] - minDate) / (maxDate - minDate || 1)) * chartW;
      const y = padding.top + chartH - (values[i] / maxValue) * chartH;
      return { x, y, commit };
    });

    // Calculate tooltip position based on point position
    const getTooltipPosition = (point) => {
      if (!svgRef.current) return { x: 0, y: 0 };

      const svgRect = svgRef.current.getBoundingClientRect();

      // Convert SVG coordinates to container coordinates
      const scaleX = svgRect.width / w;
      const scaleY = svgRect.height / h;

      const x = point.x * scaleX;
      const y = point.y * scaleY;

      return { x, y };
    };

    const handlePointEnter = (point) => {
      setHoveredCommit({ commit: point.commit, point });
    };

    const handleMouseLeave = (e) => {
      // Check if we're moving to the tooltip
      if (tooltipRef.current && tooltipRef.current.contains(e.relatedTarget)) {
        return;
      }
      setHoveredCommit(null);
    };

    const handleTooltipMouseLeave = () => {
      setHoveredCommit(null);
    };

    // Grid lines
    const gridLines = [];
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (chartH / 5) * i;
      gridLines.push(
        <line
          key={`h-${i}`}
          x1={padding.left}
          y1={y}
          x2={padding.left + chartW}
          y2={y}
          stroke="#334155"
          strokeWidth="1"
        />,
      );
    }

    // Y-axis labels
    const yLabels = [];
    for (let i = 0; i <= 5; i++) {
      const value = Math.round((maxValue / 5) * (5 - i));
      const y = padding.top + (chartH / 5) * i;
      yLabels.push(
        <text
          key={`y-${i}`}
          x={padding.left - 15}
          y={y}
          fill="#9ca3af"
          fontSize="12"
          textAnchor="end"
          dominantBaseline="middle"
        >
          {value}
        </text>,
      );
    }

    // X-axis labels (time)
    const dateLabels = [];
    for (let i = 0; i <= 5; i++) {
      const date = new Date(minDate + ((maxDate - minDate) / 5) * i);
      const x = padding.left + (chartW / 5) * i;
      dateLabels.push(
        <text
          key={`date-${i}`}
          x={x}
          y={padding.top + chartH + 25}
          fill="#9ca3af"
          fontSize="12"
          textAnchor="middle"
        >
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </text>,
      );
    }

    const tooltipPosition = hoveredCommit
      ? getTooltipPosition(hoveredCommit.point)
      : { x: 0, y: 0 };
    const isTooltipOnRight = tooltipPosition.x < 450;

    return (
      <div
        ref={containerRef}
        className="relative bg-slate-800 rounded border border-slate-700 p-4"
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${w} ${h}`}
          className="w-full"
          style={{ height: "300px" }}
          onMouseLeave={handleMouseLeave}
        >
          {/* Grid */}
          {gridLines}

          {/* Axes labels */}
          {yLabels}
          {dateLabels}

          {/* Y-axis title */}
          <text
            x={20}
            y={h / 2}
            fill="#d1d5db"
            fontSize="13"
            fontWeight="600"
            textAnchor="middle"
            transform={`rotate(-90, 20, ${h / 2})`}
          >
            Lines Changed
          </text>

          {/* X-axis title */}
          <text
            x={w / 2}
            y={h - 10}
            fill="#d1d5db"
            fontSize="13"
            fontWeight="600"
            textAnchor="middle"
          >
            Time
          </text>

          {/* Commit points with larger hover area */}
          {points.map((point) => {
            const isHovered = hoveredCommit?.commit.sha === point.commit.sha;
            const radius = isHovered ? 5 : 3;

            return (
              <g key={point.commit.sha}>
                {/* Invisible larger hitbox for easier hovering */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={10}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => handlePointEnter(point)}
                />
                {/* Visible point */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={radius}
                  fill={isHovered ? "#0ea5e9" : "#38bdf8"}
                  className="pointer-events-none"
                  stroke={isHovered ? "#0284c7" : "none"}
                  strokeWidth={isHovered ? 2 : 0}
                />
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {hoveredCommit && (
          <div
            ref={tooltipRef}
            className="absolute z-50 bg-slate-700 border border-slate-600 rounded shadow-lg p-3 min-w-[280px] max-w-[350px] cursor-pointer hover:border-sky-400 transition-colors"
            style={{
              left: isTooltipOnRight
                ? `${tooltipPosition.x + 15}px`
                : `${tooltipPosition.x - 295}px`,
              top: `${tooltipPosition.y - 80}px`,
            }}
            onMouseLeave={handleTooltipMouseLeave}
            onClick={() => window.open(hoveredCommit.commit.url, "_blank")}
          >
            <div className="flex items-start gap-2 mb-2">
              {hoveredCommit.commit.authorAvatar && (
                <img
                  src={hoveredCommit.commit.authorAvatar}
                  alt={hoveredCommit.commit.author}
                  className="w-6 h-6 rounded-full"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">
                  {hoveredCommit.commit.author}
                </div>
                <div className="text-xs text-gray-400 font-mono">
                  {hoveredCommit.commit.sha.substring(0, 7)}
                </div>
              </div>
            </div>

            <div className="text-sm text-gray-200 mb-2 line-clamp-2">
              {hoveredCommit.commit.message.split("\n")[0]}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs mb-2">
              <div className="bg-emerald-900 border border-emerald-700 rounded px-2 py-1">
                <div className="text-emerald-400 font-semibold">
                  +{hoveredCommit.commit.additions}
                </div>
                <div className="text-gray-400">added</div>
              </div>
              <div className="bg-rose-900 border border-rose-700 rounded px-2 py-1">
                <div className="text-rose-400 font-semibold">
                  -{hoveredCommit.commit.deletions}
                </div>
                <div className="text-gray-400">deleted</div>
              </div>
            </div>

            <div className="text-xs text-gray-400 pt-2 border-t border-slate-600">
              <div>{hoveredCommit.commit.filesChanged} files changed</div>
              <div>{hoveredCommit.commit.date.toLocaleString()}</div>
              <div className="text-sky-400 mt-1 font-medium">
                Click to view on GitHub →
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <Header />

      {rateLimitModal && (
        <RateLimitWarning
          data={rateLimitModal}
          onClose={() => setRateLimitModal(null)}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Disclaimer */}
        <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <div className="text-xl">⚡</div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-amber-300 mb-1">
                    API Rate Limit Warning
                  </h3>
                  <p className="text-sm text-amber-100">
                    Don't refresh too quickly! GitHub has API rate limits (60
                    requests/hour for unauthenticated users). If you exceed the
                    limit, you'll see a warning indicating when you can refresh
                    again. Consider using a VPN or switching networks if you hit
                    the limit frequently.
                  </p>
                </div>
                {timeUntilRefresh !== null && (
                  <div className="bg-amber-900/50 border border-amber-600 rounded px-4 py-3 whitespace-nowrap">
                    <div className="text-xs text-amber-300 mb-1">
                      Next refresh:
                    </div>
                    <div className="text-2xl font-mono font-bold text-amber-400">
                      {Math.floor(timeUntilRefresh / 60)}:
                      {String(timeUntilRefresh % 60).padStart(2, "0")}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold text-white">
              Repository Analytics
            </h1>
            {isCachedData && cacheTimestamp && (
              <div className="bg-blue-900/50 border border-blue-700 rounded px-3 py-1 text-xs text-blue-300">
                💾 Cached data • Updated {formatCacheTime(cacheTimestamp)}
              </div>
            )}
          </div>
          <a
            href={`https://github.com/${owner}/${repo}`}
            target="_blank"
            rel="noreferrer"
            className="text-lg text-sky-400 hover:underline"
          >
            https://github.com/{owner}/{repo}
          </a>

          {/* Repository metadata */}
          {repoMeta && (
            <div className="flex flex-wrap gap-3 mt-4">
              {repoMeta.forks_count !== undefined && (
                <div className="bg-slate-800 border border-slate-700 rounded px-3 py-1 text-sm text-gray-100">
                  🔱 {repoMeta.forks_count.toLocaleString()} forks
                </div>
              )}
              {repoMeta.open_issues_count !== undefined && (
                <div className="bg-slate-800 border border-slate-700 rounded px-3 py-1 text-sm text-gray-100">
                  ⚠️ {repoMeta.open_issues_count.toLocaleString()} issues
                </div>
              )}
              {repoMeta.language && (
                <div className="bg-slate-800 border border-slate-700 rounded px-3 py-1 text-sm text-gray-100">
                  {repoMeta.language}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Contributors */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">Contributors</h2>
            {isCachedData && contributors.length > 0 && (
              <div className="text-xs text-blue-400">💾 Cached</div>
            )}
          </div>

          {loading && <p className="text-gray-400">Loading contributors...</p>}
          {error && <p className="text-red-400">{error}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {contributors.map((c) => (
              <a
                key={c.id}
                href={c.html_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 p-3 bg-slate-800 border border-slate-700 rounded hover:border-sky-500 hover:shadow-lg transition"
              >
                <img
                  src={c.avatar_url}
                  alt={c.login}
                  className="w-10 h-10 rounded-full"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white truncate">{c.login}</p>
                  <p className="text-sm text-gray-400">
                    {c.contributions} commits
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Commit Activity */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">
            Commit Activity
          </h2>

          {/* Date filters and actions */}
          <div className="bg-slate-800 border border-slate-700 rounded p-4 mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-300">
                  Start:
                </label>
                <input
                  type="datetime-local"
                  className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-400"
                  value={toLocalInput(since)}
                  onChange={(e) => setSince(new Date(e.target.value))}
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-300">
                  End:
                </label>
                <input
                  type="datetime-local"
                  className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-400"
                  value={toLocalInput(until)}
                  onChange={(e) => setUntil(new Date(e.target.value))}
                />
              </div>

              <button
                className="ml-auto bg-sky-600 hover:bg-sky-500 text-white px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50 disabled:bg-slate-600"
                onClick={fetchCommits}
                disabled={commitsLoading}
              >
                {commitsLoading ? "Loading..." : "Refresh"}
              </button>
            </div>

              {commitsLoading && (
              <div className="mt-3 text-sm text-sky-400">
                Fetching commits...
              </div>
            )}
            
            {lastRefreshTime && !commitsLoading && (
              <p className="mt-3 text-xs text-gray-400">
                Last refreshed: {lastRefreshTime.toLocaleString()}
              </p>
            )}
          </div>

          {commitsError && (
            <div className="bg-red-900 border border-red-700 rounded p-4 mb-4">
              <p className="text-red-200">{commitsError}</p>
            </div>
          )}

          {/* Stats summary */}
          {!commitsLoading && filteredCommits.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div className="bg-slate-800 border border-slate-700 rounded p-4">
                <div className="text-sm text-gray-400 mb-1">Total Commits</div>
                <div className="text-2xl font-bold text-white">
                  {stats.totalCommits}
                </div>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded p-4">
                <div className="text-sm text-gray-400 mb-1">Lines Added</div>
                <div className="text-2xl font-bold text-emerald-400">
                  +{stats.totalAdditions}
                </div>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded p-4">
                <div className="text-sm text-gray-400 mb-1">Lines Removed</div>
                <div className="text-2xl font-bold text-rose-400">
                  -{stats.totalDeletions}
                </div>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded p-4">
                <div className="text-sm text-gray-400 mb-1">Net Change</div>
                <div
                  className={`text-2xl font-bold ${stats.netLines >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {stats.netLines >= 0 ? "+" : ""}
                  {stats.netLines}
                </div>
              </div>
            </div>
          )}

          {/* Graph */}
          {!commitsLoading && filteredCommits.length > 0 && (
            <CommitGraph commits={filteredCommits} />
          )}

          {/* Empty states */}
          {!commitsLoading &&
            filteredCommits.length === 0 &&
            commits.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded p-8 text-center">
                <p className="text-gray-400">
                  No commits found in the selected date range
                </p>
              </div>
            )}

          {!commitsLoading && commits.length === 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded p-8 text-center">
              <p className="text-gray-400 mb-1">
                Click "Refresh" to load commit data
              </p>
              <p className="text-sm text-gray-500">
                Large repositories may take a moment to load
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RepoPage;
