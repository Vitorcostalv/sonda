"use client";

import { useId, useState } from "react";
import { Pause, Play } from "lucide-react";

/** Decorative observation field; never represents live scan data. */
export function RadarField() {
  const id = useId().replace(/:/g, "");
  const [paused, setPaused] = useState(false);
  return (
    <div className="radar-panel" data-paused={paused}>
      <div className="radar-coord">
        <span>OBSERVATION FIELD</span>
        <span>SONDA / 001</span>
      </div>
      <div className="field-scene" aria-hidden="true">
        <svg className="field-svg" viewBox="0 0 400 400" fill="none">
          <defs>
            <radialGradient id={`${id}-sphere`} cx="38%" cy="30%" r="70%">
              <stop stopColor="#42d6c4" stopOpacity=".16" />
              <stop offset=".65" stopColor="#163b3a" stopOpacity=".24" />
              <stop offset="1" stopColor="#080f16" stopOpacity=".95" />
            </radialGradient>
            <linearGradient
              id={`${id}-orbit`}
              x1="50"
              y1="100"
              x2="350"
              y2="300"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#42d6c4" stopOpacity=".08" />
              <stop offset=".5" stopColor="#67f4d7" />
              <stop offset="1" stopColor="#82b0da" stopOpacity=".16" />
            </linearGradient>
            <radialGradient id={`${id}-halo`}>
              <stop stopColor="#42d6c4" stopOpacity=".14" />
              <stop offset="1" stopColor="#42d6c4" stopOpacity="0" />
            </radialGradient>
            <clipPath id={`${id}-clip`}>
              <circle cx="200" cy="200" r="111" />
            </clipPath>
            <filter
              id={`${id}-glow`}
              x="-100%"
              y="-100%"
              width="300%"
              height="300%"
            >
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <circle cx="200" cy="205" r="180" fill={`url(#${id}-halo)`} />
          <g stroke="#36545d" strokeWidth=".7">
            <path d="M20 200H380M200 20V380" strokeDasharray="2 7" />
            <circle cx="200" cy="200" r="174" strokeDasharray="1 9" />
            <circle cx="200" cy="200" r="145" strokeOpacity=".45" />
            {Array.from({ length: 36 }, (_, i) => (
              <path
                key={i}
                d={i % 3 === 0 ? "M200 17V27" : "M200 19V23"}
                transform={`rotate(${i * 10} 200 200)`}
              />
            ))}
          </g>
          <g className="field-body">
            <ellipse
              cx="200"
              cy="324"
              rx="80"
              ry="10"
              fill="#42d6c4"
              opacity=".08"
              filter={`url(#${id}-glow)`}
            />
            <circle
              cx="200"
              cy="200"
              r="111"
              fill={`url(#${id}-sphere)`}
              stroke="#42d6c4"
              strokeOpacity=".4"
            />
            <g
              clipPath={`url(#${id}-clip)`}
              stroke="#42d6c4"
              strokeWidth=".7"
              strokeOpacity=".22"
            >
              {[32, 65, 94].map((r) => (
                <ellipse key={r} cx="200" cy="200" rx={r} ry="111" />
              ))}
              {[145, 175, 205, 235, 265].map((y) => (
                <ellipse key={y} cx="200" cy={y} rx="111" ry="24" />
              ))}
              <path
                className="field-meridian"
                d="M200 89C84 130 84 270 200 311C316 270 316 130 200 89Z"
                strokeOpacity=".65"
              />
              <path
                className="field-scanline"
                d="M80 200H320"
                stroke="#9fffe6"
                strokeWidth="2"
              />
            </g>
            <g stroke={`url(#${id}-orbit)`}>
              <ellipse
                className="field-orbit"
                cx="200"
                cy="200"
                rx="168"
                ry="57"
                transform="rotate(-27 200 200)"
              />
              <ellipse
                className="field-orbit secondary"
                cx="200"
                cy="200"
                rx="155"
                ry="65"
                transform="rotate(54 200 200)"
                strokeDasharray="4 10"
              />
              <ellipse
                cx="200"
                cy="200"
                rx="135"
                ry="123"
                transform="rotate(28 200 200)"
                strokeOpacity=".2"
              />
            </g>
            <g className="field-satellite">
              <circle cx="200" cy="200" r="156" stroke="transparent" />
              <circle cx="200" cy="44" r="5" fill="#8affde" />
              <circle
                cx="200"
                cy="44"
                r="10"
                stroke="#42d6c4"
                strokeOpacity=".5"
              />
              <circle
                cx="200"
                cy="44"
                r="8"
                fill="#42d6c4"
                filter={`url(#${id}-glow)`}
              />
            </g>
            <g className="field-core">
              <circle
                cx="200"
                cy="200"
                r="32"
                fill="#102622"
                stroke="#42d6c4"
                strokeOpacity=".6"
              />
              <path
                d="M200 181L216 187V200C216 210 207 217 200 221C193 217 184 210 184 200V187L200 181Z"
                stroke="#8affde"
                strokeWidth="1.5"
              />
              <path
                d="M193 200L198 205L208 194"
                stroke="#8affde"
                strokeWidth="1.5"
              />
            </g>
          </g>
          <g className="field-callouts" stroke="#45645f" strokeWidth=".8">
            <path d="M266 121L296 93H363M122 231L88 257H29M268 274L300 304H370" />
            <circle cx="266" cy="121" r="3" fill="#42d6c4" stroke="none" />
            <circle cx="122" cy="231" r="3" fill="#ddb46b" stroke="none" />
            <circle cx="268" cy="274" r="3" fill="#82b0da" stroke="none" />
          </g>
          <g className="field-text" fill="#aac7c4">
            <text x="301" y="86">
              HTTPS / TLS
            </text>
            <text x="29" y="272" fill="#ddb46b">
              HEADERS
            </text>
            <text x="304" y="319" fill="#82b0da">
              COOKIES
            </text>
            <text x="195" y="12" fill="#668581">
              N
            </text>
            <text x="389" y="203" fill="#668581">
              E
            </text>
          </g>
        </svg>
      </div>
      <div className="radar-coord bottom">
        <span>VISUALIZAÇÃO CONCEITUAL</span>
        <button
          className="field-motion-toggle"
          type="button"
          onClick={() => setPaused(!paused)}
          aria-label={paused ? "Retomar efeito visual" : "Pausar efeito visual"}
          aria-pressed={paused}
        >
          {paused ? <Play size={10} /> : <Pause size={10} />}
          {paused ? "RETOMAR" : "PAUSAR"}
        </button>
      </div>
    </div>
  );
}
