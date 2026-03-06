// ViewAllUsers.tsx
// Staff page that displays all registered users
// along with their reservation statistics.

import { useEffect, useState } from "react"
import { getAllUsers } from "../../api/users"

export default function ViewAllUsers() {
  // State storing all retrieved users
  const [users, setUsers] = useState<any[]>([])

  useEffect(() => {
    async function loadUsers() {
      try {
        const data = await getAllUsers()
        setUsers(data)
      } catch (err) {
        console.error(err)
      }
    }

    loadUsers()
  }, [])

  return (
    <div>
      <h2>All Users</h2>

      <table border={1} cellPadding={10}>
        <thead>
          <tr>
            <th>User ID</th>
            <th>Email</th>
            <th>Days Registered</th>
            <th>Total Reservations</th>
            <th>Past Reservations</th>
            <th>Upcoming Reservations</th>
          </tr>
        </thead>

        <tbody>
          {users.map((u) => (
            <tr key={u.userID}>
              <td>{u.userID}</td>
              <td>{u.email}</td>
              <td>{u.days_registered}</td>
              <td>{u.total_reservations}</td>
              <td>{u.past_reservations}</td>
              <td>{u.upcoming_reservations}</td>
            </tr>
          ))}
        </tbody>

      </table>
    </div>
  )
}