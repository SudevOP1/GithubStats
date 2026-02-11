import { useParams } from "react-router-dom";

const RepoPage = () => {
  let { owner, repo } = useParams();
  return (
    <div>
      <p className="bg-yellow-100">hi</p>
      {owner}
      {repo}
    </div>
  );
};

export default RepoPage;
