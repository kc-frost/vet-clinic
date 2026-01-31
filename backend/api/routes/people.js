import { createCrudRouter } from "../lib/tableCrud.js";


// Create and export CRUD API routes for staff members
// - routeName: sets the API endpoint path (e.g., /api/people)
// - tableName: indicates the database table these routes operate on ("staff")
export default createCrudRouter({ routeName: "people", tableName: "staff" });



