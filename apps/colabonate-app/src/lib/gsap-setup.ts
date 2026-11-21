import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// Einmalige GSAP-Plugin-Registrierung für die gesamte App.
// Wird in main.tsx importiert – danach ist ScrollTrigger überall verfügbar.
gsap.registerPlugin(ScrollTrigger)
