import { Routes, Route } from "react-router-dom";
import type { User } from "../../api/types";
import FormList from "./FormList";
import FormEditor from "./FormEditor";
import FormFill from "./FormFill";
import FormResponses from "./FormResponses";

interface FormsAppProps {
  user: User;
}

/** FormsApp mounts the Forms routes under /forms:
 *  - /forms                list of forms + templates
 *  - /forms/d/:id          editor (questions tab)
 *  - /forms/d/:id/responses responses summary + individual
 *  - /forms/d/:id/viewform  fill / preview view
 */
export default function FormsApp({ user }: FormsAppProps) {
  return (
    <Routes>
      <Route path="/" element={<FormList user={user} />} />
      <Route path="/d/:id" element={<FormEditor user={user} />} />
      <Route path="/d/:id/responses" element={<FormResponses user={user} />} />
      <Route path="/d/:id/viewform" element={<FormFill user={user} />} />
    </Routes>
  );
}
