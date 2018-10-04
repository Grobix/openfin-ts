import any = jasmine.any;

export default class Order {

  public error = null;

  private intReqTan = false;
  private intSendMsg = [];
  private intGmsgList = [];

  constructor(public client) {}

  public requireTan() {
    this.intReqTan = true;
  }

this.msg = function (in_data) {
    // 0. check no error
    if (this.error) {
      return false;
    }
    // 1. check if we support one of the segment versions
    let act_vers = 0;
    if (in_data.ki_type in client.bpd.gv_parameters) {
      let avail_vers = Object.keys(in_data.send_msg).sort(function (a, b) {
        return b - a;
      });
      for (let i in avail_vers) {
        if (avail_vers[i] in client.bpd.gv_parameters[in_data.ki_type]) {
          act_vers = avail_vers[i];
          break;
        }
      }
    }
    if (act_vers == 0) {
      this.error = new Exceptions.GVNotSupportedByKI(in_data.ki_type, client.bpd.gv_parameters[in_data.ki_type]);
      return false;
    }
    // 2. Find the appropriate action
    let act = null;
    if (typeof in_data.recv_msg === 'function') {
      act = in_data.recv_msg;
    } else if (act_vers in in_data.recv_msg) {
      act = in_data.recv_msg[act_vers];
    } else if (0 in in_data.recv_msg) {
      act = in_data.recv_msg[0];
    } else {
      act = function () {};
    }
    // 3. Prepare the Send Message object
    int_send_msg.push({
      version: act_vers,
      segment: Helper.newSegFromArray(in_data.type, act_vers, in_data.send_msg[act_vers]),
      action: act,
      aufsetzpunkt: null,
      aufsetzpunkt_loc: (in_data.aufsetzpunkt_loc ? in_data.aufsetzpunkt_loc : []),
      finished: false,
      collected_segments: [],
      collected_messages: [],
    });
  };

this.done = function (cb) {
    // Exit CB is called when the function returns here it is checked if an error occures and then disconnects
    let exit_cb = function (error, order, recvMsg) {
      if (error) {
        this.client.MsgEndDialog(function (error2, recvMsg2) {
          if (error2) {
            this.client.log.con.error({
              error: error2,
            },                        'Connection close failed after error.');
          } else {
            this.client.log.con.debug('Connection closed okay, after error.');
          }
        });
      }
      cb(error, order, recvMsg);
    };
    // Main Part
    if (this.error) {
      exit_cb(this.error, this, null);
    } else {
      // Message prepare
      let perform = function () {
        let msg = new Nachricht(this.client.proto_version);
        msg.sign({
          pin: this.client.pin,
          tan: NULL,
          sys_id: this.client.sys_id,
          pin_vers: this.client.upd.availible_tan_verfahren[0],
          sig_id: this.client.getNewSigId(),
        });
        msg.init(this.client.dialog_id, this.client.next_msg_nr, this.client.blz, this.client.kunden_id);
        this.client.next_msg_nr++;
        // Fill in Segments

        for (let j in int_send_msg) {
          if (!int_send_msg[j].finished) {
            // 1. Resolve Aufsetzpunkt if required, TODO here diferntiate between versions
            if (int_send_msg[j].aufsetzpunkt) {
              if (int_send_msg[j].aufsetzpunkt_loc.length >= 1) {
                for (; int_send_msg[j].segment.store.data.length < int_send_msg[j].aufsetzpunkt_loc[0];) {
                  int_send_msg[j].segment.store.addDE(NULL);
                }
                if (int_send_msg[j].aufsetzpunkt_loc.length <= 1) {
                  // direkt
                  int_send_msg[j].segment.store.data[int_send_msg[j].aufsetzpunkt_loc[0] - 1] = int_send_msg[j].aufsetzpunkt;
                } else {
                  // Unter DEG
                  exit_cb(new Exceptions.InternalError('Aufsetzpunkt Location is in DEG not supported yet.'), this, null);
                  return;
                }
              } else {
                exit_cb(new Exceptions.InternalError('Aufsetzpunkt Location is not set but an aufsetzpunkt was delivered'), this, null);
                return;
              }
            }
            // 2. Add Segment
            msg.addSeg(int_send_msg[j].segment);
          }
        }
        // Send Segments to Destination
        this.client.SendMsgToDestination(msg, function (error, recvMsg) {
          if (error) {
            exit_cb(error, this, null);
          } else {
            let got_aufsetzpunkt = false;
            // 1. global Message testen
            let gmsg_exception = null;
            try {
              let HIRMG = recvMsg.selectSegByName('HIRMG')[0];
              for (let i in HIRMG.store.data) {
                int_gmsg_list.push(HIRMG.store.data[i].data);
                if (gmsg_exception == null && HIRMG.store.data[i].data[0].charAt(0) == '9') {
                  gmsg_exception = new Exceptions.OrderFailedException(HIRMG.store.data[i].data);
                }
              }
            } catch (ee) {
              exit_cb(new Exceptions.MalformedMessageFormat('HIRMG is mandatory but missing.'), this, recvMsg);
              return;
            }
            if (gmsg_exception != null) {
              exit_cb(gmsg_exception, this, recvMsg);
              return;
            }
            // 2. einzelne Resp Segmente durchgehen
            try {
              for (let j in int_send_msg) {
                let related_segments = recvMsg.selectSegByBelongTo(int_send_msg[j].segment.nr);
                int_send_msg[j].finished = true;
                for (let i in related_segments) {
                  if (related_segments[i].name == 'HIRMS') {
                    let HIRMS = related_segments[i];
                    for (let a in HIRMS.store.data) {
                      int_send_msg[j].collected_messages.push(HIRMS.store.data[a].data);
                      if (HIRMS.store.data[a].data[0] == '3040') {
                        // Got an Aufsetzpunkt
                        try {
                          int_send_msg[j].aufsetzpunkt = HIRMS.store.data[a].data[3];
                        } catch (eee) {
                          int_send_msg[j].aufsetzpunkt = null;
                        }
                        int_send_msg[j].finished = false;
                        got_aufsetzpunkt = true;
                      }
                    }
                  } else {
                    int_send_msg[j].collected_segments.push(related_segments[i]);
                  }
                }
              }
            } catch (ee) {
              exit_cb(new Exceptions.InternalError('Failed parsing Segments'), this, recvMsg);
            }
            // 3. check if we had an aufsetzpunkt
            if (got_aufsetzpunkt) {
              perform();
            } else {
              // 4. Fertig die callbacks rufen
              for (let j in int_send_msg) {
                int_send_msg[j].action(int_send_msg[j].version, int_send_msg[j].collected_segments, int_send_msg[j].collected_messages, recvMsg);
              }
              exit_cb(null, this, recvMsg);
            }
          }
        });
      };
      perform();
    }
  };

this.checkMessagesOkay = function (messages, throw_when_error) {
    for (let i in messages) {
      let type = messages[i][0].charAt(0);
      if (type == '9') {
        if (throw_when_error) {
          Exceptions.GVFailedAtKI(messages[i]);
        }
        return false;
      }
    }
    return true;
  };

this.getSegByName = function (list, name) {
    for (let i in list) {
      if (list[i].name == name) {
        return list[i];
      }
    }
    return null;
  };

this.getElFromSeg = function (seg, nr, default_v) {
    if (seg) {
      let e = null;
      try {
        e = seg.getEl(nr);
      } catch (e2) {
        e = default_v;
      }
      return e;
    } else {
      return default_v;
    }
  };

this.checkKITypeAvailible = function (ki_type, vers, return_param) {
    if (ki_type in this.client.bpd.gv_parameters) {
      let p_return = {};
      let test_vers = [];

      if (vers instanceof Array) {
        test_vers = test_vers.concat(vers);
      } else {
        test_vers.push(vers);
      }

      for (let vindex in test_vers) {
        if (test_vers[vindex] in this.client.bpd.gv_parameters[ki_type]) {
          if (return_param) {
            p_return[vindex] = this.client.bpd.gv_parameters[ki_type][test_vers[vindex]];
          } else {
            return true;
          }
        }
      }

      if (return_param) {
        return p_return;
      } else {
        return false;
      }
    } else {
      if (return_param) {
        return {};
      } else {
        return false;
      }
    }
  };
}
