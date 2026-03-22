'use client';

import React, { useEffect, useState } from 'react';
import Lottie from 'lottie-react';
import './AnimatedBackground.css';

export default function AnimatedBackground() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [animationData, setAnimationData] = useState<any>(null);

  useEffect(() => {
    fetch('/lottie-test-1.json')
      .then(res => res.json())
      .then(data => setAnimationData(data))
      .catch(console.error);
  }, []);

  return (
    <div className="scenery-container theme-lottie-valley">
      <div className="bg-base" />
      {animationData && (
        <Lottie 
          animationData={animationData} 
          loop={true} 
          autoplay={true} 
          rendererSettings={{ preserveAspectRatio: 'xMidYMid slice' }}
          style={{ width: '100vw', height: '100vh', position: 'absolute', top: 0, left: 0, opacity: 0.9 }}
        />
      )}
    </div>
  );
}
