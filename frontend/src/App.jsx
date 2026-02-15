import { BrowserRouter, Route, Routes } from "react-router-dom";

import LandingPage from "./pages/LandingPage.jsx";
import RepoPage from "./pages/RepoPage.jsx";

function App() {
  return (
    <BrowserRouter basename="/GithubStats/">
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/:owner/:repo" element={<RepoPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
