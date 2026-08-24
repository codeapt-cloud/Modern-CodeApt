/**
 * College operator (faculty / college_admin) GameSet management — the shared
 * GameSetList with the tenant authoring adapter. Includes the "Start from a
 * template" clone flow (the adapter exposes templates/clone for college).
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { GameSetList } from "../../components/game/admin/GameSetList.js";
import { collegeGameAuthoringApi } from "../../lib/game-authoring-api.js";
import { useCollege } from "./college-context.js";

export function CollegeGameSetsPage() {
  const { slug } = useCollege();
  const navigate = useNavigate();
  const authApi = useMemo(() => collegeGameAuthoringApi(slug), [slug]);
  return (
    <GameSetList
      authApi={authApi}
      onNew={() => navigate(`/c/${slug}/gaming/new`)}
      onEdit={(id) => navigate(`/c/${slug}/gaming/${id}`)}
      onResults={(id) => navigate(`/c/${slug}/gaming/${id}/cohort`)}
    />
  );
}
