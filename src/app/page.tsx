'use client';

import React, { useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { CodeShowcase } from '@/components/CodeShowcase';
import { BentoGrid } from '@/components/BentoGrid';
import { ColdWakeBenchmark } from '@/components/ColdWakeBenchmark';
import { UsageEstimator } from '@/components/UsageEstimator';
import { ConsoleSidebar, ConsoleTab } from '@/components/ConsoleSidebar';
import { ConsoleWorkspace, MicroVMFunction, SecretItem } from '@/components/ConsoleWorkspace';
import { NewFunctionModal } from '@/components/NewFunctionModal';
import { AddSecretModal } from '@/components/AddSecretModal';
import { Footer } from '@/components/Footer';

export default function Home() {
  const [viewMode, setViewMode] = useState<'landing' | 'console'>('landing');
  const [activeConsoleTab, setActiveConsoleTab] = useState<ConsoleTab>('overview');

  const [functions, setFunctions] = useState<MicroVMFunction[]>([]);
  const [secrets, setSecrets] = useState<SecretItem[]>([]);

  const [isNewFuncModalOpen, setIsNewFuncModalOpen] = useState(false);
  const [isAddSecretModalOpen, setIsAddSecretModalOpen] = useState(false);

  const handleAddFunction = (newFunc: MicroVMFunction) => {
    setFunctions(prev => [newFunc, ...prev]);
  };

  const handleAddSecret = (newSecret: SecretItem) => {
    setSecrets(prev => [newSecret, ...prev]);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)' }}>
      {/* Navbar */}
      <Navbar viewMode={viewMode} setViewMode={setViewMode} />

      {/* VIEW MODE 1: LANDING PAGE */}
      {viewMode === 'landing' && (
        <div>
          {/* Hero */}
          <section className="axiom-hero">
            <div className="container">
              <h1 className="hero-title">
                MicroVM scale-to-zero <span className="bottle-highlight">without the cold-start penalty.</span>
              </h1>

              <p className="hero-subtitle">
                Gregale runs serverless applications inside isolated Firecracker microVMs. Apps park as memory snapshots on NVMe storage when inactive and unpark on request in &lt;350ms. Zero resident memory when parked.
              </p>

              <div className="hero-actions">
                <button className="btn btn-gregale" onClick={() => setViewMode('console')}>
                  Launch Console
                </button>
                <a href="#architecture" className="btn btn-secondary">Explore Architecture</a>

                <div className="command-box">
                  <span>$</span>
                  <code>curl -fsSL https://get.gregale.dev | sh</code>
                </div>
              </div>

              {/* Code Showcase Component */}
              <CodeShowcase />
            </div>
          </section>

          {/* Architecture Bento Grid */}
          <BentoGrid />

          {/* Cold Wake Benchmark Simulator */}
          <ColdWakeBenchmark />

          {/* Pricing Matrix & Calculator */}
          <UsageEstimator onSelectPlan={() => setViewMode('console')} />

          {/* Footer */}
          <Footer />
        </div>
      )}

      {/* VIEW MODE 2: CLOUD PROVIDER MANAGEMENT CONSOLE */}
      {viewMode === 'console' && (
        <div className="console-wrapper">
          <ConsoleSidebar 
            activeTab={activeConsoleTab} 
            setActiveTab={setActiveConsoleTab} 
            vmsCount={functions.length}
          />
          <ConsoleWorkspace 
            activeTab={activeConsoleTab}
            setActiveTab={setActiveConsoleTab}
            functions={functions}
            setFunctions={setFunctions}
            secrets={secrets}
            setSecrets={setSecrets}
            openNewFuncModal={() => setIsNewFuncModalOpen(true)}
            openAddSecretModal={() => setIsAddSecretModalOpen(true)}
          />
        </div>
      )}

      {/* Modals */}
      <NewFunctionModal 
        isOpen={isNewFuncModalOpen} 
        onClose={() => setIsNewFuncModalOpen(false)} 
        onAddFunction={handleAddFunction}
      />
      <AddSecretModal 
        isOpen={isAddSecretModalOpen} 
        onClose={() => setIsAddSecretModalOpen(false)} 
        onAddSecret={handleAddSecret}
      />
    </div>
  );
}
