import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";

const LandingPage = () => {
  const [searchInput, setSearchInput] = useState("");
  const navigate = useNavigate();

  const parseGithubUrl = (url) => {
    // Remove https://, www., and github.com parts
    let cleaned = url
      .replace(/^https:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/^github\.com\//i, "")
      .replace(/\/$/, ""); // Remove trailing slash

    // Extract owner/repo
    const parts = cleaned.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
    return null;
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const result = parseGithubUrl(searchInput);
    if (result) {
      navigate(`/${result.owner}/${result.repo}`);
      setSearchInput("");
    } else {
      alert("Invalid GitHub URL. Please enter a valid URL or owner/repo.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <Header />

      <div className="max-w-4xl mx-auto px-4 py-24">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-extrabold text-white mb-4">
            GitHub Repository Analytics
          </h1>
          <p className="text-xl text-gray-300 mb-8">
            Monitor, analyze, and visualize your GitHub repositories in
            real-time. Track commits, contributors, and code changes
            effortlessly.
          </p>
        </div>

        {/* Search Box */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-8 mb-12">
          <h2 className="text-2xl font-semibold text-white mb-6 text-center">
            Search a Repository
          </h2>
          <form onSubmit={handleSearch} className="flex gap-3">
            <input
              type="text"
              placeholder="https://github.com/owner/repo"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="flex-1 bg-slate-700 border border-slate-600 rounded px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-sky-500"
            />
            <button
              type="submit"
              className="bg-sky-600 hover:bg-sky-500 text-white px-8 py-3 rounded font-medium transition"
            >
              Search
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
