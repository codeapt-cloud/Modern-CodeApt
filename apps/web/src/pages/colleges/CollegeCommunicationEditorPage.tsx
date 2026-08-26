/**
 * College communication composite authoring — now a THIN wrapper (S30) over the
 * shared CommunicationAssessmentEditor with the college adapter. The editor guts
 * moved to components/communication/admin/CommunicationAssessmentEditor so the
 * platform surface reuses the SAME component (a second composite editor is the
 * failure the adapter pattern exists to prevent). Route + entitlement gate +
 * `?id=` param + navigation are unchanged, so the tenant behaviour is identical.
 */
import { CollegeFeature, checkEntitlement } from "@codeapt/shared";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { CommunicationAssessmentEditor } from "../../components/communication/admin/CommunicationAssessmentEditor.js";
import { Alert } from "../../components/ui/alert.js";
import { collegeCommunicationAuthoringApi } from "../../lib/communication-authoring-api.js";
import { useCollege } from "./college-context.js";

export function CollegeCommunicationEditorPage() {
  const { slug, context } = useCollege();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editingId = params.get("id");
  const canAuthor = checkEntitlement(
    context.entitlements,
    CollegeFeature.COMMUNICATION,
    "authoring",
  );
  const authApi = useMemo(() => collegeCommunicationAuthoringApi(slug), [slug]);
  const listPath = `/c/${slug}/communication/assessments`;

  if (!canAuthor) {
    return <Alert variant="info">You don’t have communication authoring access.</Alert>;
  }

  return (
    <CommunicationAssessmentEditor
      authApi={authApi}
      surface="college"
      assessmentId={editingId}
      onSaved={() => navigate(listPath)}
      onBack={() => navigate(listPath)}
    />
  );
}

export default CollegeCommunicationEditorPage;
