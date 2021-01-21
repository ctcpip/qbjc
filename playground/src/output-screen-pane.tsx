import IconButton from '@material-ui/core/IconButton';
import {useTheme} from '@material-ui/core/styles';
import Tooltip from '@material-ui/core/Tooltip';
import BlockIcon from '@material-ui/icons/Block';
import _ from 'lodash';
import {autorun} from 'mobx';
import React, {useCallback, useEffect, useRef} from 'react';
import {Terminal} from 'xterm';
import {FitAddon} from 'xterm-addon-fit';
import * as xtermWebfont from 'xterm-webfont';
import 'xterm/css/xterm.css';
import configManager, {ConfigKey} from './config-manager';
import PaneHeader from './pane-header';

function OutputScreenPane({
  onReady = () => {},
  style = {},
  dimensions = null,
  isRunning = false,
}: {
  onReady?: (terminal: Terminal) => void;
  style?: React.CSSProperties;
  dimensions?: any;
  isRunning?: boolean;
} = {}) {
  const theme = useTheme();
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddOnRef = useRef<FitAddon | null>(null);
  const init = useCallback(
    async (node: HTMLDivElement | null) => {
      if (!node || terminalRef.current) {
        return;
      }
      const terminal = new Terminal({
        // Output from compiled program will only specify \n for new lines, which need to be
        // translated to \r\n.
        convertEol: true,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new xtermWebfont());
      // @ts-ignore: method added by xterm-webfont addon
      await terminal.loadWebfontAndOpen(node);
      autorun(() => {
        terminal.setOption(
          'fontFamily',
          configManager.getKey(ConfigKey.SCREEN_FONT_FAMILY)
        );
        terminal.setOption(
          'fontSize',
          configManager.getKey(ConfigKey.SCREEN_FONT_SIZE)
        );
        terminal.setOption(
          'letterSpacing',
          configManager.getKey(ConfigKey.SCREEN_LETTER_SPACING)
        );
        terminal.setOption(
          'lineHeight',
          configManager.getKey(ConfigKey.SCREEN_LINE_HEIGHT)
        );
        fitAddon.fit();
      });
      window.addEventListener(
        'resize',
        _.debounce(() => fitAddon.fit(), 200)
      );
      terminal.onResize(({rows, cols}) =>
        console.log(`Resized terminal to ${cols}x${rows}`)
      );
      terminalRef.current = terminal;
      fitAddOnRef.current = fitAddon;
      onReady(terminal);
    },
    [onReady]
  );
  const prevDimensionsJson = useRef('');
  const dimensionsJson = JSON.stringify(dimensions);
  useEffect(() => {
    if (
      prevDimensionsJson.current === dimensionsJson ||
      !terminalRef.current ||
      !fitAddOnRef.current
    ) {
      return;
    }
    fitAddOnRef.current.fit();
    prevDimensionsJson.current = dimensionsJson;
  }, [dimensionsJson]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      <PaneHeader title="Output">
        {!isRunning && (
          <Tooltip title="Clear output">
            <IconButton onClick={() => terminalRef.current?.reset()}>
              <BlockIcon
                style={{
                  fontSize: theme.typography.overline.fontSize,
                  color: theme.palette.text.secondary,
                }}
              />
            </IconButton>
          </Tooltip>
        )}
      </PaneHeader>
      <div
        ref={init}
        style={{
          // This magic combo of flexGrow, height: 0, and overflowY makes this div take up the full
          // height in the parent but prevents it from growing beyond the parent size when changing
          // lineHeight. ¯\_(ツ)_/¯
          flexGrow: 1,
          height: 0,
          // @ts-ignore
          overflowY: 'overlay',
        }}
      ></div>
    </div>
  );
}

export default OutputScreenPane;
