/**
 * Platform-admin GameSet editor page — the shared GameSetEditor with the
 * platform adapter (surface "platform": curriculum-topic attach, no org-units).
 * `:gameSetId === "new"` is the create case. Platform admins bypass AI credit
 * metering, so the AI drafter is always available here.
 */
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { GameSetEditor } from "../../../components/game/admin/GameSetEditor.js";
import { gameAuthoringApi } from "../../../lib/game-authoring-api.js";

export function AdminGameSetEditorPage() {
  const { gameSetId = "" } = useParams();
  const navigate = useNavigate();
  const authApi = useMemo(() => gameAuthoringApi(), []);
  const back = (): void => navigate("/admin/game-sets");
  return (
    <GameSetEditor
      authApi={authApi}
      surface="platform"
      gameSetId={gameSetId === "new" ? null : gameSetId}
      aiEnabled
      onSaved={back}
      onBack={back}
    />
  );
}
