import { useState } from "react";
import { useNavigate } from "react-router-dom";

const Header = () => {
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
    <div className="bg-slate-900 border-b border-slate-700 shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center gap-4">
        <h1
          className="text-2xl font-bold text-white cursor-pointer hover:text-sky-400 transition"
          onClick={() => navigate("/")}
        >
          GithubStats
        </h1>
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="https://github.com/owner/repo"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            className="bg-sky-600 hover:bg-sky-500 text-white px-4 py-1.5 rounded text-sm font-medium transition"
          >
            Search
          </button>
        </form>
      </div>
    </div>
  );
};

export default Header;
