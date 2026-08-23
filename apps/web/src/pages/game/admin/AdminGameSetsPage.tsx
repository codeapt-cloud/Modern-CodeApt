/**
 * Platform-admin GameSet management. Thin wrapper over the shared GameSetList
 * with the platform (slug-free) authoring adapter.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { GameSetList } from "../../../components/game/admin/GameSetList.js";
import { PageHeader } from "../../../components/layout/PageHeader.js";
import { gameAuthoringApi } from "../../../lib/game-authoring-api.js";

export function AdminGameSetsPage() {
  const navigate = useNavigate();
  const authApi = useMemo(() => gameAuthoringApi(), []);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Game sets"
        description="Author platform game sets and attach them to curriculum topics."
      />
      <GameSetList
        authApi={authApi}
        onNew={() => navigate("/admin/game-sets/new")}
        onEdit={(id) => navigate(`/admin/game-sets/${id}`)}
      />
    </div>
  );
}
