import { Link } from "react-router-dom";
import "../../styles/home.css";

export default function Home() {
  return (
    <div className="home">
      <div className="homeInner">
        <section className="hero">
          <p className="kicker">Veterinary Clinic + Doggy Daycare</p>

          <h1 className="title">Happy Healthy Pets!</h1>

          <p className="subtitle">
            Welcome to our clinic management prototype. Users/Staff can log in to view and manage
            inventory items. Later features will expand appointments and reservations.
          </p>



        </section>

      </div>
    </div>
  );
}
