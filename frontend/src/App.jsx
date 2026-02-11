import { BrowserRouter, Route, Routes } from "react-router";

import LandingPage from "./pages/LandingPage.jsx";
import RepoPage from "./pages/RepoPage.jsx";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/:owner/:repo" element={<RepoPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
