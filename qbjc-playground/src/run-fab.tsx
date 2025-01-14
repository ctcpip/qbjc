import Fab from '@material-ui/core/Fab';
import Tooltip from '@material-ui/core/Tooltip';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import StopIcon from '@material-ui/icons/Stop';
import {observer} from 'mobx-react';
import React, {useCallback} from 'react';
import QbjcManager from './qbjc-manager';

const RunFab = observer(({qbjcManager}: {qbjcManager: QbjcManager}) => {
  const isRunning = qbjcManager.isRunning;
  return (
    <div
      style={{
        position: 'absolute',
        right: '2rem',
        bottom: '2rem',
      }}
    >
      <div style={{position: 'relative'}}>
        <Tooltip title={isRunning ? 'Stop program' : 'Run program'}>
          <Fab
            onClick={useCallback(async () => {
              if (isRunning) {
                qbjcManager.stop();
              } else {
                await qbjcManager.run();
              }
            }, [qbjcManager, isRunning])}
            color={isRunning ? 'secondary' : 'primary'}
            style={{
              zIndex: 10,
            }}
          >
            {isRunning ? <StopIcon /> : <PlayArrowIcon />}
          </Fab>
        </Tooltip>
        {/*
        isRunning && (
          <CircularProgress
            size={68}
            style={{position: 'absolute', top: -6, left: -6, zIndex: 1}}
          />
        )
        */}
      </div>
    </div>
  );
});

export default RunFab;
