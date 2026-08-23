/**
 * College GameSet editor page — the shared GameSetEditor with the tenant adapter
 * (surface "college": org-unit targeting, no topic attach). The AI drafter is
 * shown only when the college has the GAMING.ai_build sub-capability.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { GameSetEditor } from "../../components/game/admin/GameSetEditor.js";
import { api } from "../../lib/api-client.js";
import { collegeGameAuthoringApi } from "../../lib/game-authoring-api.js";
import { useQuery } from "../../lib/use-query.js";
import { useCollege } from "./college-context.js";

export function CollegeGameSetEditorPage() {
  const { slug, context } = useCollege();
  const { gameSetId = "" } = useParams();
  const navigate = useNavigate();
  const authApi = useMemo(() => collegeGameAuthoringApi(slug), [slug]);
  const aiEnabled = checkEntitlement(
    context.entitlements,
    CollegeFeature.GAMING,
    "ai_build",
  );
  const tree = useQuery(() => api.collegeOrgUnits.listTree(slug), [slug]);
  const back = (): void => navigate(`/c/${slug}/gaming`);
  return (
    <GameSetEditor
      authApi={authApi}
      surface="college"
      gameSetId={gameSetId === "new" ? null : gameSetId}
      aiEnabled={aiEnabled}
      orgUnitTree={tree.data?.items ?? []}
      role={context.membership.role}
      onSaved={back}
      onBack={back}
    />
  );
}
