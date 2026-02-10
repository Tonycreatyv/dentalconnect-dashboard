type LobbyHeroWhite3DProps = {
  title: string;
  subtitle?: string;
  rightText?: string;
};

export const LobbyHeroWhite3D = ({ title, subtitle, rightText }: LobbyHeroWhite3DProps) => {
  return (
    <div className="lobby3d">
      {/* luces suaves */}
      <div className="lobby3d-glow" aria-hidden />

      {/* “piso” en perspectiva */}
      <div className="lobby3d-floor" aria-hidden />

      {/* paneles flotando (estilo “cards” de sala de espera) */}
      <div className="lobby3d-panels" aria-hidden>
        <div className="lobby3d-panel" />
        <div className="lobby3d-panel" />
        <div className="lobby3d-panel" />
      </div>

      {/* contenido */}
      <div className="lobby3d-content">
        <div className="lobby3d-left">
          <div className="lobby3d-kicker">LOBBY</div>
          <h1 className="lobby3d-title">{title}</h1>
          {subtitle ? <p className="lobby3d-subtitle">{subtitle}</p> : null}
        </div>

        {rightText ? (
          <div className="lobby3d-right">
            <span className="lobby3d-badge">{rightText}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};
