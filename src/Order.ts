import { Exceptions } from './Exceptions';
import FinTSClient from './FinTSClient';
import Helper from './Helper';
import Nachricht from './Nachricht';
import { NULL } from './NULL';
import OrderHelperChain from './OrderHelperChain';
import Segment from './Segment';
import SendMessage from './SendMessage';
import SignInfo from './SignInfo';

export default class Order {

  public error = null;

  private intReqTan = false;
  private intSendMsg: SendMessage[] = [];
  private intGmsgList = [];

  constructor(public client: FinTSClient) {}

  public requireTan() {
    this.intReqTan = true;
  }

  public msg(inData) {
    // 0. check no error
    if (this.error) {
      return false;
    }
    // 1. check if we support one of the segment versions
    let actVers: any = 0;
    if (inData.ki_type in this.client.bpd.gvParameters) {
      const availVers = Object.keys(inData.send_msg).sort((a: any, b: any) => {
        return (b - a);
      });
      for (const i in availVers) {
        if (availVers[i] in this.client.bpd.gvParameters[inData.ki_type]) {
          actVers = availVers[i];
          break;
        }
      }
    }
    if (actVers === 0) {
      this.error = new Exceptions.GVNotSupportedByKI(inData.ki_type, this.client.bpd.gvParameters[inData.ki_type]);
      return false;
    }
    // 2. Find the appropriate action
    let act = null;
    if (typeof inData.recv_msg === 'function') {
      act = inData.recv_msg;
    } else if (actVers in inData.recv_msg) {
      act = inData.recv_msg[actVers];
    } else if (0 in inData.recv_msg) {
      act = inData.recv_msg[0];
    } else {
      act = () => {
        // empty
      };
    }

    // 3. Prepare the Send Message object
    const sendMsg = new SendMessage();
    sendMsg.action = act;
    sendMsg.aufsetzpunktLoc = (inData.aufsetzpunkt_loc ? inData.aufsetzpunkt_loc : []);
    sendMsg.segment = Helper.newSegFromArray(inData.type, actVers, inData.send_msg[actVers]);
    sendMsg.version = actVers;
    this.intSendMsg.push(sendMsg);
  }

  public done(cb) {
    // Exit CB is called when the function returns here it is checked if an error occures and then disconnects
    const extCb = (error, order, recvMsg) => {
      if (error) {
        this.client.msgEndDialog((error2, recvMsg2) => {
          if (error2) {
            this.client.conLog.error({
              error: error2,
            }, 'Connection close failed after error.');
          } else {
            this.client.conLog.debug('Connection closed okay, after error.');
          }
        });
      }
      cb(error, order, recvMsg);
    };
    // Main Part
    if (this.error) {
      extCb(this.error, this, null);
    } else {
      // Message prepare
      const perform = () => {
        const msg = new Nachricht(this.client.protoVersion);
        const signInfo = new SignInfo();
        signInfo.pin = this.client.pin;
        signInfo.tan = NULL;
        signInfo.sysId = this.client.sysId;
        signInfo.sigId = this.client.getNewSigId();
        signInfo.pinVersion = this.client.upd.availableTanVerfahren[0];
        msg.sign(signInfo);
        msg.init(this.client.dialogId, this.client.nextMsgNr, this.client.blz, this.client.kundenId);
        this.client.nextMsgNr += 1;
        // Fill in Segments

        for (const j in this.intSendMsg) {
          const sendMessage: SendMessage = this.intSendMsg[j];

          if (sendMessage.finished) {
            continue;
          }
          // 1. Resolve Aufsetzpunkt if required, TODO here differentiate between versions
          if (sendMessage.aufsetzpunkt) {
            if (sendMessage.aufsetzpunktLoc.length >= 1) {
              for (; sendMessage.segment.store.data.length < sendMessage.aufsetzpunktLoc[0];) {
                sendMessage.segment.store.addDE(NULL);
              }
              if (sendMessage.aufsetzpunktLoc.length <= 1) {
                // direkt
                sendMessage.segment.store.data[sendMessage.aufsetzpunktLoc[0] - 1].data = sendMessage.aufsetzpunkt;
                // Unter DEG
                extCb(new Exceptions.InternalError('Aufsetzpunkt Location is in DEG not supported yet.'), this, null);
                return;
              }
            } else {
              extCb(new Exceptions.InternalError('Aufsetzpunkt Location is not set but an aufsetzpunkt was delivered'), this, null);
              return;
            }
          }
          // 2. Add Segment
          msg.addSeg(sendMessage.segment);
        }
        // Send Segments to Destination
        this.client.sendMsgToDestination(msg, (error, recvMsg) => {
          if (error) {
            extCb(error, this, null);
          } else {
            let gotAufsetzpunkt = false;
            // 1. global Message testen
            let gmsgException = null;
            try {
              const HIRMG = recvMsg.selectSegByName('HIRMG')[0];
              for (const i in HIRMG.store.data) {
                this.intGmsgList.push(HIRMG.store.data[i].data.data);
                if (gmsgException == null && HIRMG.store.data[i].data.data[0].data.charAt(0) === '9') {
                  gmsgException = new Exceptions.OrderFailedException(HIRMG.store.data[i].data.data);
                }
              }
            } catch (ee) {
              extCb(new Exceptions.MalformedMessageFormat('HIRMG is mandatory but missing.'), this, recvMsg);
              return;
            }
            if (gmsgException != null) {
              extCb(gmsgException, this, recvMsg);
              return;
            }
            // 2. einzelne Resp Segmente durchgehen
            try {
              for (const j in this.intSendMsg) {
                const sendMessage: SendMessage = this.intSendMsg[j];
                const relatedSegments = recvMsg.selectSegByBelongTo(sendMessage.segment.nr);
                sendMessage.finished = true;
                relatedSegments.forEach(segment => {
                  if (segment.name !== 'HIRMS') {
                    sendMessage.collectedSegments.push(segment);
                    return;
                  }

                  const HIRMS = segment;
                  HIRMS.store.data.forEach(deg => {
                    sendMessage.collectedMessages.push(deg.data);
                    if (deg.data.data[0].data === '3040') {
                      // Got an Aufsetzpunkt
                      try {
                        sendMessage.aufsetzpunkt = deg.data.data[3].data;
                      } catch (eee) {
                        sendMessage.aufsetzpunkt = null;
                      }
                      sendMessage.finished = false;
                      gotAufsetzpunkt = true;
                    }
                  });

                });
              }
            } catch (ee) {
              extCb(new Exceptions.InternalError('Failed parsing Segments'), this, recvMsg);
            }
            // 3. check if we had an aufsetzpunkt
            if (gotAufsetzpunkt) {
              perform();
            } else {
              // 4. Fertig die callbacks rufen
              this.intSendMsg.forEach((sendMessage: SendMessage) => {
                sendMessage.action(sendMessage.version, sendMessage.collectedSegments, sendMessage.collectedMessages, recvMsg);
              });
              extCb(null, this, recvMsg);
            }
          }
        });
      };
      perform();
    }
  }

  public checkMessagesOkay(messages, throwError) {
    for (const i in messages) {
      const type = messages[i].data[0].data.charAt(0);
      if (type === '9') {
        if (throwError) {
          throw new Exceptions.GVFailedAtKI(messages[i]);
        }
        return false;
      }
    }
    return true;
  }

  public getSegByName(list: Segment[], name) {
    const result = list.find(segment => segment.name === name);
    if (!result) {
      return null;
    }
    return result;
  }

  public getElFromSeg(seg: Segment, nr, defaultValue) {
    if (!seg) {
      return defaultValue;
    }
    let e = null;
    try {
      e = seg.getEl(nr);
    } catch (e2) {
      e = defaultValue;
    }
    return e;
  }

  public checkKITypeAvailible = (kiType, vers, returnParam?) => {
    if (kiType in this.client.bpd.gvParameters) {
      const pReturn = {};
      let testVers = [];

      if (vers instanceof Array) {
        testVers = testVers.concat(vers);
      } else {
        testVers.push(vers);
      }

      for (const vindex in testVers) {
        if (testVers[vindex] in this.client.bpd.gvParameters[kiType]) {
          if (returnParam) {
            pReturn[vindex] = this.client.bpd.gvParameters[kiType][testVers[vindex]];
          } else {
            return true;
          }
        }
      }

      if (returnParam) {
        return pReturn;
      }
      return false;
    }
    if (returnParam) {
      return {};
    }
    return false;
  }

  public helper(): OrderHelperChain {
    return new OrderHelperChain(this);
  }
}
