import "../../styles/home.css";

import heroVet from "../../assets/home/hero-vet.jpg";
import wellnessImg from "../../assets/home/wellness.jpg";
import dentalImg from "../../assets/home/dental.jpg";
import diagnosticsImg from "../../assets/home/diagnostics.jpg";
import groomingImg from "../../assets/home/grooming.jpg";
import emergencyImg from "../../assets/home/emergency.jpg";
import procedureImg from "../../assets/home/procedure.jpg";

export default function Home() {
  return (
    <div className="home">
      <section className="hero">
        <img src={heroVet} alt="Veterinarian caring for a pet" className="heroImage" />

        <div className="heroText">
          
          <h1 className="title">Caring, convenient pet care for every visit.</h1>
          <p className="subtitle">
            Our clinic helps pet owners schedule appointments, manage pet information,
            and stay connected with the care their pets receive.
          </p>
        </div>
      </section>

      <div className="homeInner">
        <section className="homeSection missionSection">
          <div className="missionBrandWrapper">
            <h3 className="missionBrand">PetWell Clinic 🐾</h3>
          </div>

          <h2 className="missionTitle">Our Mission</h2>

          <p className="missionText">
            Our mission is to help every pet feel safe, comfortable, and cared for from the moment
            they arrive. We want pet owners to feel confident knowing their pets are receiving
            friendly, reliable care in a welcoming clinic environment.
          </p>
          </section>

        <section className="homeSection">
          <h2>Our Services</h2>

          <div className="serviceGrid">
            <div className="serviceCard">
              <img src={wellnessImg} alt="Veterinary wellness exam" className="serviceImage" />
              <div className="serviceContent">
                <h3>Wellness & Preventative Care</h3>
                <p>
                  Wellness exams, rabies vaccination, and bordetella vaccination to help keep
                  your pet healthy.
                </p>
              </div>
            </div>

            <div className="serviceCard">
              <img src={dentalImg} alt="Veterinary dental care" className="serviceImage" />
              <div className="serviceContent">
                <h3>Dental Care</h3>
                <p>
                  Dental cleanings and extractions to support your pet’s oral health and comfort.
                </p>
              </div>
            </div>

            <div className="serviceCard">
              <img src={diagnosticsImg} alt="Veterinary diagnostics" className="serviceImage" />
              <div className="serviceContent">
                <h3>Diagnostics</h3>
                <p>
                  X-ray evaluation and ultrasound imaging to help identify medical concerns.
                </p>
              </div>
            </div>

            <div className="serviceCard">
              <img src={procedureImg} alt="Pet treatment and recovery" className="serviceImage" />
              <div className="serviceContent">
                <h3>Procedures & Treatment</h3>
                <p>
                  Cast changes and treatment support for pets recovering from injuries.
                </p>
              </div>
            </div>

            <div className="serviceCard">
              <img src={groomingImg} alt="Pet grooming services" className="serviceImage" />
              <div className="serviceContent">
                <h3>Grooming Services</h3>
                <p>
                Basic grooming, flea bath grooming, and grooming with dye options to help pets look,
                feel, and stay their best.
                </p>
              </div>
            </div>

            <div className="serviceCard">
              <img src={emergencyImg} alt="Emergency veterinary care" className="serviceImage" />
              <div className="serviceContent">
                <h3>Emergency Care</h3>
                <p>
                  Emergency and trauma care for urgent situations that need quick attention.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="homeSection">
          <h2>Why Choose Our Clinic?</h2>
          <p>
            We understand that pets are family, so we focus on making each visit as calm and
            comfortable as possible. From wellness visits and vaccinations to grooming, diagnostics,
            and emergency care, our clinic offers a variety of services in one convenient place.
          </p>
          <p>
            Pet owners can easily schedule appointments, keep track of important pet information,
            and stay connected with their pet's care. Our goal is to make veterinary visits feel
            less stressful and more supportive for both pets and their owners.
          </p>
        </section>

        <section className="homeSection">
          <h2>New Clients Welcome</h2>
          <p>
            Whether you are scheduling a wellness exam, grooming appointment, vaccination,
            dental visit, or emergency service, our website is designed to make the process
            simple and easy to follow.
          </p>
        </section>

        <section className="homeSection contactSection">
          <h2>Contact Information</h2>
          <p><strong>Location:</strong> Austin, TX</p>
          <p><strong>Phone:</strong> (512) 555-0123</p>
          <p><strong>Email:</strong> vclinic480@gmail.com</p>
          <p><strong>Hours:</strong> Monday - Friday, 9:00 AM - 5:00 PM</p>
        </section>
      </div>
    </div>
  );
}
